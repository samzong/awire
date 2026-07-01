/**
 * awire — fetch entry point.
 *
 * Three route families:
 *
 *   POST /hook/github            GitHub webhook (no auth — verified by HMAC)
 *   GET  /                       Health check (public)
 *   *    /api/v1/*               JSON management API (Bearer token)
 *   GET  /<PANEL_PATH>           Panel shell (auth via Bearer token)
 *   GET  /<PANEL_PATH>/<page>    Panel pages (fragment swap)
 *   GET  /<PANEL_PATH>/fragments/*
 *   *    /<PANEL_PATH>/api/*
 *
 * The management JSON API is mounted as a small Hono app so its route
 * definitions can also generate the OpenAPI document used by Lathe.
 */

import { checkAndMarkDelivery } from "./dedup.ts";
import { resolveRoute, shouldForward } from "./config.ts";
import { sendCard } from "./feishu.ts";
import { renderEvent } from "./render/index.ts";
import type { Env, GitHubPayload } from "./types.ts";
import { verifyGitHubSignature } from "./verify.ts";
import { extractToken, buildSessionCookieHeader, verifyPanelToken } from "./panel/auth.ts";
import { renderLoginPage, renderPanelShell, type NavKey } from "./panel/html.ts";
import * as api from "./panel/api.ts";
import { handleJsonApi } from "./json-api.ts";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    try {
      // -------------------------------------------------------------------
      // Health
      // -------------------------------------------------------------------
      if (path === "/" && method === "GET") {
        return json({ ok: true, service: "awire" });
      }

      // -------------------------------------------------------------------
      // GitHub webhook
      // -------------------------------------------------------------------
      if (path === "/hook/github" && method === "POST") {
        return await handleWebhook(req, env);
      }

      if (path === "/api/v1" || path.startsWith("/api/v1/")) {
        return await handleJsonApi(req, env);
      }

      // -------------------------------------------------------------------
      // Panel — everything under PANEL_PATH
      // -------------------------------------------------------------------
      const panelPath = env.PANEL_PATH?.replace(/^\/+|\/+$/g, "") ?? "";
      if (!panelPath) {
        return json({ error: "panel not configured" }, 500);
      }

      // Match exact "/<PANEL_PATH>" or "/<PANEL_PATH>/...".
      if (path === `/${panelPath}` || path.startsWith(`/${panelPath}/`)) {
        return await handlePanel(req, env, path, panelPath);
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(JSON.stringify({
        level: "error", msg: "unhandled", error: stringifyError(err), path, method,
      }));
      return json({ error: "internal" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// ===========================================================================
// WEBHOOK HANDLER
// ===========================================================================

async function handleWebhook(req: Request, env: Env): Promise<Response> {
  const event = req.headers.get("X-GitHub-Event") ?? "";
  const deliveryId = req.headers.get("X-GitHub-Delivery");
  const rawBody = await req.arrayBuffer();

  const payload = parseWebhookPayload(rawBody, req.headers.get("content-type"));
  if (!payload) {
    logWebhook("warn", "webhook_invalid_json", {
      delivery: deliveryId,
      event,
      contentType: req.headers.get("content-type"),
    });
    return json({ error: "invalid json" }, 400);
  }

  const action = typeof payload.action === "string" ? payload.action : undefined;
  const repoFullName = payload.repository?.full_name ?? "";
  const logFields = { delivery: deliveryId, event, action, repo: repoFullName };

  logWebhook("info", "webhook_received", logFields);

  const route = await resolveRoute(env.CONFIG_KV, repoFullName);
  if (route?.webhook_secret) {
    const sig = req.headers.get("X-Hub-Signature-256");
    const verify = await verifyGitHubSignature(sig, rawBody, route.webhook_secret);
    if (!verify.ok) {
      logWebhook("warn", "signature_rejected", { ...logFields, reason: verify.reason });
      return json({ error: "invalid signature" }, 401);
    }
  }

  const dedup = await checkAndMarkDelivery(env.DEDUP_KV, deliveryId);
  if (dedup.duplicate) {
    logWebhook("info", "dedup_duplicate", logFields);
    return json({ ok: true, dedup: true });
  }

  if (event === "ping") {
    if (!route) {
      logWebhook("info", "route_missing", logFields);
    } else if (!shouldForward(route.events, "ping", undefined)) {
      logWebhook("info", "event_filtered", { ...logFields, channel: route.channel.id });
    } else {
      const card = renderEvent("ping", undefined, payload);
      if (card) {
        const result = await sendCard(route.channel.webhook_url, card, route.channel.sign_secret);
        if (result.ok) {
          logWebhook("info", "forwarded", { ...logFields, channel: route.channel.id });
        } else {
          logWebhook("error", "feishu_failed", {
            ...logFields,
            channel: route.channel.id,
            httpStatus: result.httpStatus,
            feishuCode: result.statusCode,
            feishuMsg: result.message,
          });
        }
      }
    }
    return json({ ok: true });
  }

  if (!route) {
    logWebhook("info", "route_missing", logFields);
    return json({ ok: true, ignored: "no route" });
  }

  if (!shouldForward(route.events, event, action)) {
    logWebhook("info", "event_filtered", { ...logFields, channel: route.channel.id });
    return json({ ok: true, filtered: true });
  }

  const card = renderEvent(event, action, payload);
  if (!card) {
    logWebhook("info", "renderer_dropped", { ...logFields, channel: route.channel.id });
    return json({ ok: true, dropped: "renderer" });
  }

  const result = await sendCard(route.channel.webhook_url, card, route.channel.sign_secret);
  if (!result.ok) {
    logWebhook("error", "feishu_failed", {
      ...logFields,
      channel: route.channel.id,
      httpStatus: result.httpStatus, feishuCode: result.statusCode, feishuMsg: result.message,
    });
    return json({ error: "feishu", message: result.message }, 502);
  }

  logWebhook("info", "forwarded", { ...logFields, channel: route.channel.id });
  return json({ ok: true });
}

function logWebhook(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function parseWebhookPayload(rawBody: ArrayBuffer, contentType: string | null): GitHubPayload | null {
  const body = new TextDecoder().decode(rawBody);
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") {
    try {
      return JSON.parse(body) as GitHubPayload;
    } catch {
    }
  }

  const payloadText = new URLSearchParams(body).get("payload");
  if (!payloadText) return null;

  try {
    return JSON.parse(payloadText) as GitHubPayload;
  } catch {
    return null;
  }
}

// ===========================================================================
// PANEL HANDLER
// ===========================================================================

async function handlePanel(req: Request, env: Env, path: string, panelPath: string): Promise<Response> {
  const method = req.method.toUpperCase();
  // Strip leading "/<PANEL_PATH>" → remainder ("" or "/dashboard" etc.)
  const rest = path.slice(`/${panelPath}`.length);
  const baseUrl = new URL(req.url);

  // -------------------------------------------------------------------------
  // Login endpoints (unauthenticated)
  // -------------------------------------------------------------------------
  if (rest === "" || rest === "/") {
    if (method === "GET") {
      // Already-authed user (cookie present + valid) → skip login, go to dashboard.
      const authed = await extractToken(req, env.PANEL_TOKEN);
      if (authed) {
        return Response.redirect(new URL(`/${panelPath}/dashboard`, baseUrl).toString(), 302);
      }
      return html(renderLoginPage(`/${panelPath}`));
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (rest === "/login" && method === "POST") {
    // Form submission from the login page. Validate the token, set a cookie,
    // and redirect to the dashboard. The browser carries the cookie on the
    // redirect, so the dashboard GET is authenticated.
    const form = await req.formData();
    const token = String(form.get("token") ?? "").trim();
    if (!token || !(await verifyPanelToken(token, env.PANEL_TOKEN))) {
      return Response.redirect(new URL(`/${panelPath}?err=1`, baseUrl).toString(), 303);
    }
    const headers = new Headers({
      Location: new URL(`/${panelPath}/dashboard`, baseUrl).toString(),
      "Set-Cookie": buildSessionCookieHeader(token, panelPath),
    });
    return new Response(null, { status: 303, headers });
  }

  if (rest === "/logout" && method === "POST") {
    const headers = new Headers({
      Location: new URL(`/${panelPath}`, baseUrl).toString(),
      "Set-Cookie": `${"awire_session"}=; Path=/${panelPath}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    });
    return new Response(null, { status: 303, headers });
  }

  // -------------------------------------------------------------------------
  // All other panel routes require auth (Bearer header OR session cookie).
  // -------------------------------------------------------------------------
  const authed = await extractToken(req, env.PANEL_TOKEN);
  if (!authed) {
    const isHtmx = req.headers.get("HX-Request") === "true";
    const acceptsHtml = (req.headers.get("Accept") ?? "").includes("text/html");
    if (!isHtmx && acceptsHtml) {
      // Browser navigation without a session → login page.
      return Response.redirect(new URL(`/${panelPath}`, baseUrl).toString(), 302);
    }
    return json({ error: "unauthorized" }, 401);
  }

  // -------------------------------------------------------------------------
  // Pages — return the full panel shell with the active page rendered inline.
  // -------------------------------------------------------------------------
  if (method === "GET" && (rest === "/dashboard" || rest === "/repos" || rest === "/channels")) {
    const page = rest.slice(1) as NavKey;
    const webhookUrl = buildWebhookUrl(req);
    const content = await pageFragment(env, page, `/${panelPath}`, webhookUrl);
    return html(renderPanelShell({
      panelPath: `/${panelPath}`,
      activeNav: page,
      initialContent: content,
    }));
  }

  // -------------------------------------------------------------------------
  // Fragments (HTMX partial swaps)
  // -------------------------------------------------------------------------
  if (method === "GET" && rest.startsWith("/fragments/")) {
    return html(await handleFragment(req, env, rest.slice("/fragments/".length), `/${panelPath}`));
  }

  // -------------------------------------------------------------------------
  // API (mutations)
  // -------------------------------------------------------------------------
  if (rest.startsWith("/api/")) {
    return html(await handleApi(req, env, rest.slice("/api/".length), `/${panelPath}`));
  }

  return json({ error: "not found" }, 404);
}

async function pageFragment(env: Env, page: NavKey, panelPath: string, webhookUrl: string): Promise<string> {
  switch (page) {
    case "dashboard":
      return await api.fragmentDashboard(env, panelPath, webhookUrl);
    case "channels":
      return await api.fragmentChannels(env, panelPath);
    case "repos":
      return await api.fragmentRepos(env, panelPath);
  }
}

async function handleFragment(req: Request, env: Env, sub: string, panelPath: string): Promise<string> {
  const webhookUrl = buildWebhookUrl(req);
  if (sub === "dashboard") return await api.fragmentDashboard(env, panelPath, webhookUrl);
  if (sub === "channels") return await api.fragmentChannels(env, panelPath);
  if (sub === "channels/new") return api.fragmentChannelNew(panelPath);
  if (sub.startsWith("channels/") && sub.endsWith("/edit")) {
    const id = decodeURIComponent(sub.slice("channels/".length, -"/edit".length));
    return await api.fragmentChannelEdit(env, panelPath, id);
  }
  if (sub === "repos") return await api.fragmentRepos(env, panelPath);
  if (sub === "repos/new") return await api.fragmentRepoNewAsync(env, panelPath);
  if (sub.startsWith("repos/") && sub.endsWith("/edit")) {
    const full = decodeURIComponent(sub.slice("repos/".length, -"/edit".length));
    return await api.fragmentRepoEdit(env, panelPath, full);
  }
  return notFoundHtml("fragment");
}

async function handleApi(req: Request, env: Env, sub: string, panelPath: string): Promise<string> {
  const method = req.method.toUpperCase();

  if (sub === "whoami" && method === "GET") return api.apiWhoami();

  if (sub === "channels" && method === "POST") return await api.apiChannelCreate(env, panelPath, req);

  if (sub.startsWith("channels/")) {
    const parts = sub.slice("channels/".length).split("/");
    const id = decodeURIComponent(parts[0] ?? "");
    const op = parts[1];
    if (op === "test" && method === "POST") return await api.apiChannelTest(env, panelPath, id);
    if (op === undefined && method === "DELETE") return await api.apiChannelDelete(env, panelPath, id);
    if (op === undefined && method === "POST") {
      // _method=put override (HTML forms can't PUT)
      const form = await req.clone().formData();
      if (form.get("_method") === "put") return await api.apiChannelUpdate(env, panelPath, req, id);
    }
  }

  if (sub === "repos" && method === "POST") return await api.apiRepoCreate(env, panelPath, req);

  if (sub.startsWith("repos/")) {
    const parts = sub.slice("repos/".length).split("/");
    const full = decodeURIComponent(parts[0] ?? "");
    const op = parts[1];
    if (op === undefined && method === "DELETE") return await api.apiRepoDelete(env, panelPath, full);
    if (op === undefined && method === "POST") {
      const form = await req.clone().formData();
      if (form.get("_method") === "put") return await api.apiRepoUpdate(env, panelPath, req, full);
    }
  }

  return notFoundHtml("api");
}

// ===========================================================================
// Helpers
// ===========================================================================

function buildWebhookUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.origin}/hook/github`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function notFoundHtml(kind: string): string {
  return `<div class="bg-ink-850 border border-ink-700 rounded-lg px-4 py-3 text-sm text-ink-400">Not found (${kind})</div>`;
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}
