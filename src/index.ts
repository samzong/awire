/**
 * awire — fetch entry point.
 *
 * Three route families:
 *
 *   POST /hook/github/<account> GitHub webhook (no auth — verified by HMAC)
 *   GET  /                       Health check (public)
 *   *    /api/v1/*               JSON management API (Bearer token)
 *   GET  /<PANEL_PATH>           Panel shell (GitHub OAuth session)
 *   GET  /<PANEL_PATH>/<page>    Panel pages (fragment swap)
 *   GET  /<PANEL_PATH>/fragments/*
 *   *    /<PANEL_PATH>/api/*
 *
 * The management JSON API is mounted as a small Hono app so its route
 * definitions can also generate the OpenAPI document used by Lathe.
 */

import { checkAndMarkDelivery } from "./dedup.ts";
import { resolveRoute, shouldForward } from "./config.ts";
import { deliver, type DeliveryResult } from "./delivery.ts";
import { renderEvent } from "./render/index.ts";
import type { Env, GitHubPayload } from "./types.ts";
import { verifyGitHubSignature } from "./verify.ts";
import {
  buildGitHubAuthorizeUrl,
  buildOAuthStateCookieHeader,
  buildSignedSessionCookieHeader,
  clearOAuthStateCookieHeader,
  clearSessionCookieHeader,
  exchangeGitHubCode,
  hasGitHubOAuthConfig,
  randomOAuthState,
  readPanelSession,
  type PanelSession,
  verifyOAuthState,
} from "./panel/auth.ts";
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
      if ((path === "/hook/github" || path.startsWith("/hook/github/")) && method === "POST") {
        return await handleWebhook(req, env, webhookAccountId(path));
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

async function handleWebhook(req: Request, env: Env, accountId: string | undefined): Promise<Response> {
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
  const logFields = { delivery: deliveryId, event, action, repo: repoFullName, ...(accountId ? { account: accountId } : {}) };

  logWebhook("info", "webhook_received", logFields);

  const route = await resolveRoute(env.CONFIG_KV, repoFullName, accountId);
  if (route?.webhook_secret) {
    const sig = req.headers.get("X-Hub-Signature-256");
    const verify = await verifyGitHubSignature(sig, rawBody, route.webhook_secret);
    if (!verify.ok) {
      logWebhook("warn", "signature_rejected", { ...logFields, reason: verify.reason });
      return json({ error: "invalid signature" }, 401);
    }
  }

  const dedup = await checkAndMarkDelivery(env.DEDUP_KV, deliveryId, accountId);
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
        const result = await deliver(route.channel, card);
        if (result.ok) {
          logWebhook("info", "forwarded", { ...logFields, channel: route.channel.id });
        } else {
          logDeliveryFailure(logFields, route.channel.id, result);
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

  const result = await deliver(route.channel, card);
  if (!result.ok) {
    logDeliveryFailure(logFields, route.channel.id, result);
    return json({ error: result.provider, message: result.message }, 502);
  }

  logWebhook("info", "forwarded", { ...logFields, channel: route.channel.id });
  return json({ ok: true });
}

function logDeliveryFailure(
  logFields: Record<string, unknown>,
  channel: string,
  result: DeliveryResult,
): void {
  if (result.provider === "feishu") {
    logWebhook("error", "feishu_failed", {
      ...logFields,
      channel,
      httpStatus: result.httpStatus,
      feishuCode: result.statusCode,
      feishuMsg: result.message,
    });
    return;
  }
  logWebhook("error", "delivery_failed", {
    ...logFields,
    channel,
    provider: result.provider,
    httpStatus: result.httpStatus,
    statusCode: result.statusCode,
    message: result.message,
  });
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
      const session = await currentSession(req, env);
      if (session) {
        return Response.redirect(new URL(`/${panelPath}/dashboard`, baseUrl).toString(), 302);
      }
      return html(renderLoginPage(`/${panelPath}`, hasGitHubOAuthConfig(env)));
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (rest === "/auth/github" && method === "GET") {
    if (!hasGitHubOAuthConfig(env)) {
      return Response.redirect(new URL(`/${panelPath}?err=config`, baseUrl).toString(), 303);
    }
    const state = randomOAuthState();
    const redirectUri = new URL(`/${panelPath}/auth/github/callback`, baseUrl).toString();
    const headers = new Headers({
      Location: buildGitHubAuthorizeUrl(env, redirectUri, state),
      "Set-Cookie": buildOAuthStateCookieHeader(state, panelPath),
    });
    return new Response(null, { status: 302, headers });
  }

  if (rest === "/auth/github/callback" && method === "GET") {
    const state = baseUrl.searchParams.get("state") ?? "";
    const code = baseUrl.searchParams.get("code") ?? "";
    if (!code || !verifyOAuthState(req, state) || !hasGitHubOAuthConfig(env)) {
      return Response.redirect(new URL(`/${panelPath}?err=oauth`, baseUrl).toString(), 303);
    }
    const redirectUri = new URL(`/${panelPath}/auth/github/callback`, baseUrl).toString();
    const headers = new Headers({
      Location: new URL(`/${panelPath}/dashboard`, baseUrl).toString(),
    });
    headers.append("Set-Cookie", clearOAuthStateCookieHeader(panelPath));
    try {
      const user = await exchangeGitHubCode(env, code, redirectUri);
      headers.append("Set-Cookie", await buildSignedSessionCookieHeader(user, env.SESSION_SECRET, panelPath));
      return new Response(null, { status: 303, headers });
    } catch {
      headers.set("Location", new URL(`/${panelPath}?err=oauth`, baseUrl).toString());
      return new Response(null, { status: 303, headers });
    }
  }

  if (rest === "/logout" && method === "POST") {
    const headers = new Headers({
      Location: new URL(`/${panelPath}`, baseUrl).toString(),
      "Set-Cookie": clearSessionCookieHeader(panelPath),
    });
    headers.append("Set-Cookie", clearOAuthStateCookieHeader(panelPath));
    return new Response(null, { status: 303, headers });
  }

  // -------------------------------------------------------------------------
  // All other panel routes require auth (Bearer header OR session cookie).
  // -------------------------------------------------------------------------
  const session = await currentSession(req, env);
  if (!session) {
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
    const webhookUrl = buildWebhookUrl(req, session.accountId);
    const content = await pageFragment(env, page, `/${panelPath}`, webhookUrl, session.accountId);
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
    return html(await handleFragment(req, env, rest.slice("/fragments/".length), `/${panelPath}`, session.accountId));
  }

  // -------------------------------------------------------------------------
  // API (mutations)
  // -------------------------------------------------------------------------
  if (rest.startsWith("/api/")) {
    return html(await handleApi(req, env, rest.slice("/api/".length), `/${panelPath}`, session.accountId));
  }

  return json({ error: "not found" }, 404);
}

async function pageFragment(env: Env, page: NavKey, panelPath: string, webhookUrl: string, accountId: string): Promise<string> {
  switch (page) {
    case "dashboard":
      return await api.fragmentDashboard(env, panelPath, webhookUrl, accountId);
    case "channels":
      return await api.fragmentChannels(env, panelPath, accountId);
    case "repos":
      return await api.fragmentRepos(env, panelPath, accountId);
  }
}

async function handleFragment(req: Request, env: Env, sub: string, panelPath: string, accountId: string): Promise<string> {
  const webhookUrl = buildWebhookUrl(req, accountId);
  if (sub === "dashboard") return await api.fragmentDashboard(env, panelPath, webhookUrl, accountId);
  if (sub === "channels") return await api.fragmentChannels(env, panelPath, accountId);
  if (sub === "channels/new") return api.fragmentChannelNew(panelPath);
  if (sub.startsWith("channels/") && sub.endsWith("/edit")) {
    const id = decodeURIComponent(sub.slice("channels/".length, -"/edit".length));
    return await api.fragmentChannelEdit(env, panelPath, id, accountId);
  }
  if (sub === "repos") return await api.fragmentRepos(env, panelPath, accountId);
  if (sub === "repos/new") return await api.fragmentRepoNewAsync(env, panelPath, accountId);
  if (sub.startsWith("repos/") && sub.endsWith("/edit")) {
    const full = decodeURIComponent(sub.slice("repos/".length, -"/edit".length));
    return await api.fragmentRepoEdit(env, panelPath, full, accountId);
  }
  return notFoundHtml("fragment");
}

async function handleApi(req: Request, env: Env, sub: string, panelPath: string, accountId: string): Promise<string> {
  const method = req.method.toUpperCase();

  if (sub === "whoami" && method === "GET") return api.apiWhoami();

  if (sub === "telegram/chats" && method === "POST") return await api.apiTelegramChats(req);

  if (sub === "channels" && method === "POST") return await api.apiChannelCreate(env, panelPath, req, accountId);

  if (sub.startsWith("channels/")) {
    const parts = sub.slice("channels/".length).split("/");
    const id = decodeURIComponent(parts[0] ?? "");
    const op = parts[1];
    if (op === "test" && method === "POST") return await api.apiChannelTest(env, panelPath, id, accountId);
    if (op === undefined && method === "DELETE") return await api.apiChannelDelete(env, panelPath, id, accountId);
    if (op === undefined && method === "POST") {
      // _method=put override (HTML forms can't PUT)
      const form = await req.clone().formData();
      if (form.get("_method") === "put") return await api.apiChannelUpdate(env, panelPath, req, id, accountId);
    }
  }

  if (sub === "repos" && method === "POST") return await api.apiRepoCreate(env, panelPath, req, accountId);

  if (sub.startsWith("repos/")) {
    const parts = sub.slice("repos/".length).split("/");
    const full = decodeURIComponent(parts[0] ?? "");
    const op = parts[1];
    if (op === undefined && method === "DELETE") return await api.apiRepoDelete(env, panelPath, full, accountId);
    if (op === undefined && method === "POST") {
      const form = await req.clone().formData();
      if (form.get("_method") === "put") return await api.apiRepoUpdate(env, panelPath, req, full, accountId);
    }
  }

  return notFoundHtml("api");
}

// ===========================================================================
// Helpers
// ===========================================================================

function webhookAccountId(path: string): string | undefined {
  const rest = path.slice("/hook/github".length);
  if (!rest || rest === "/") return undefined;
  return decodeURIComponent(rest.slice(1));
}

async function currentSession(req: Request, env: Env): Promise<PanelSession | null> {
  return env.SESSION_SECRET ? await readPanelSession(req, env.SESSION_SECRET) : null;
}

function buildWebhookUrl(req: Request, accountId?: string): string {
  const url = new URL(req.url);
  return `${url.origin}/hook/github${accountId ? `/${encodeURIComponent(accountId)}` : ""}`;
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
