/**
 * Panel API handlers — all return HTML fragments (HTMX swaps them in).
 *
 * Convention: every mutation handler returns the *updated list/card* so the
 * client re-renders coherently after the change.
 *
 * Auth is enforced by the router before any of these are called.
 */

import {
  deleteChannel,
  deleteRepo,
  getChannel,
  getRepo,
  listChannels,
  listRepos,
  putChannel,
  putRepo,
} from "../config.ts";
import { countRecentDeliveries } from "../dedup.ts";
import { sendCard } from "../feishu.ts";
import { renderCardText } from "../render/shared.ts";
import type { ChannelConfig, Env, RepoConfig } from "../types.ts";
import { renderChannelsFragment, renderChannelForm, renderTestResult, type ChannelUsage } from "./fragments/channels.ts";
import { renderReposFragment, renderRepoForm } from "./fragments/repos.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a URL-encoded form body (HTMX default submission). Returns FormData
 * so callers can use both .get() (single value) and .getAll() (all values). */
async function parseForm(req: Request): Promise<FormData> {
  return await req.formData();
}

/** Read a single form value as a trimmed string (ignores File uploads). */
function formStr(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Read all form values for a key as strings. */
function formAll(form: FormData, key: string): string[] {
  return form.getAll(key).filter((v): v is string => typeof v === "string");
}

function id(): string {
  const bytes = new Uint8Array(21);
  crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 21; i++) {
    s += alphabet[bytes[i]! % alphabet.length];
  }
  return s;
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Fragments (GET)
// ---------------------------------------------------------------------------

export async function fragmentDashboard(env: Env, _panelPath: string, webhookUrl: string): Promise<string> {
  const [channels, repos, recentEvents] = await Promise.all([
    listChannels(env.CONFIG_KV),
    listRepos(env.CONFIG_KV),
    countRecentDeliveries(env.DEDUP_KV),
  ]);
  const { renderDashboardFragment } = await import("./fragments/dashboard.ts");
  return renderDashboardFragment({ channels, repos, recentEvents, webhookUrl });
}

export async function fragmentChannels(env: Env, panelPath: string): Promise<string> {
  return await channelsTableBody(env, panelPath);
}

export function fragmentChannelNew(panelPath: string): string {
  return renderChannelForm({ panelPath });
}

export async function fragmentChannelEdit(env: Env, panelPath: string, id: string): Promise<string> {
  const ch = await getChannel(env.CONFIG_KV, id);
  if (!ch) return notFoundCard("Channel not found");
  return renderChannelForm({ panelPath, channel: ch });
}

export async function fragmentRepos(env: Env, panelPath: string): Promise<string> {
  const [repos, channels] = await Promise.all([
    listRepos(env.CONFIG_KV),
    listChannels(env.CONFIG_KV),
  ]);
  return renderReposFragment({ panelPath, repos, channels });
}

export async function fragmentRepoNewAsync(env: Env, panelPath: string): Promise<string> {
  const channels = await listChannels(env.CONFIG_KV);
  return renderRepoForm({ panelPath, channels });
}

export async function fragmentRepoEdit(env: Env, panelPath: string, fullName: string): Promise<string> {
  const [repo, channels] = await Promise.all([
    getRepo(env.CONFIG_KV, fullName),
    listChannels(env.CONFIG_KV),
  ]);
  if (!repo) return notFoundCard("Repo not found");
  return renderRepoForm({ panelPath, channels, repo });
}

// ---------------------------------------------------------------------------
// Mutations (POST / PUT via _method / DELETE)
// ---------------------------------------------------------------------------

export async function apiChannelCreate(env: Env, panelPath: string, req: Request): Promise<string> {
  const form = await parseForm(req);
  const name = formStr(form, "name");
  const webhook_url = formStr(form, "webhook_url");
  const sign_secret = formStr(form, "sign_secret") || undefined;
  if (!name || !webhook_url) return errorCard("Name and webhook URL are required");
  if (!/^https:\/\//i.test(webhook_url)) return errorCard("Webhook URL must be HTTPS");

  const ch: ChannelConfig = {
    id: id(),
    name,
    webhook_url,
    sign_secret,
    created_at: now(),
    updated_at: now(),
  };
  await putChannel(env.CONFIG_KV, ch);

  // Return the refreshed channels table body for HTMX swap.
  return await channelsTableBody(env, panelPath);
}

export async function apiChannelUpdate(env: Env, panelPath: string, req: Request, chId: string): Promise<string> {
  const form = await parseForm(req);
  const existing = await getChannel(env.CONFIG_KV, chId);
  if (!existing) return notFoundCard("Channel not found");

  const name = formStr(form, "name");
  const webhook_url = formStr(form, "webhook_url");
  // Empty string on edit = clear; absent field = keep.
  const sign_secretRaw = form.get("sign_secret");
  const sign_secret = sign_secretRaw === null
    ? existing.sign_secret
    : (typeof sign_secretRaw === "string" ? sign_secretRaw.trim() || undefined : undefined);

  if (!name || !webhook_url) return errorCard("Name and webhook URL are required");
  if (!/^https:\/\//i.test(webhook_url)) return errorCard("Webhook URL must be HTTPS");

  const updated: ChannelConfig = { ...existing, name, webhook_url, sign_secret, updated_at: now() };
  await putChannel(env.CONFIG_KV, updated);
  return await channelsTableBody(env, panelPath);
}

export async function apiChannelDelete(env: Env, panelPath: string, chId: string): Promise<string> {
  const existing = await getChannel(env.CONFIG_KV, chId);
  if (!existing) return notFoundCard("Channel not found");
  const [channels, repos] = await Promise.all([
    listChannels(env.CONFIG_KV),
    listRepos(env.CONFIG_KV),
  ]);
  const usages = channelUsages(channels, repos);
  const usage = usages[chId];
  if (usage && usage.count > 0) {
    return renderChannelsFragment({
      panelPath,
      channels,
      usages,
      notice: `Channel "${existing.name}" is still used by ${usage.label}. Remove those routes first.`,
    });
  }
  await deleteChannel(env.CONFIG_KV, chId);
  return await channelsTableBody(env, panelPath);
}

export async function apiChannelTest(env: Env, panelPath: string, chId: string): Promise<string> {
  void panelPath;
  const ch = await getChannel(env.CONFIG_KV, chId);
  if (!ch) return notFoundCard("Channel not found");

  const result = await sendCard(
    ch.webhook_url,
    renderCardText(
      "🏓 awire test",
      `**Channel:** ${ch.name}\n**Time:** ${now()}\n\nIf you see this, your Feishu webhook${ch.sign_secret ? " and signing secret" : ""} are configured correctly.`,
    ),
    ch.sign_secret,
  );
  return renderTestResult({ ok: result.ok, message: result.message, statusCode: result.statusCode });
}

export async function apiRepoCreate(env: Env, panelPath: string, req: Request): Promise<string> {
  const form = await parseForm(req);
  const full_name = formStr(form, "full_name");
  const channel_id = formStr(form, "channel_id");
  const webhook_secret = formStr(form, "webhook_secret") || undefined;

  if (!full_name) return errorCard("Repository (owner/name) is required");
  if (!channel_id) return errorCard("Target channel is required");
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(full_name)) {
    return errorCard("Repository must be in 'owner/name' format");
  }
  const channel = await getChannel(env.CONFIG_KV, channel_id);
  if (!channel) return errorCard("Selected channel does not exist");

  const eventValues = formAll(form, "events");
  const events = eventValues.includes("*") ? ["*"] : eventValues;

  const repo: RepoConfig = {
    full_name: full_name.toLowerCase(),
    channel_id,
    webhook_secret,
    events,
    created_at: now(),
    updated_at: now(),
  };
  await putRepo(env.CONFIG_KV, repo);
  return await reposListBody(env, panelPath);
}

export async function apiRepoUpdate(env: Env, panelPath: string, req: Request, fullName: string): Promise<string> {
  const existing = await getRepo(env.CONFIG_KV, fullName);
  if (!existing) return notFoundCard("Repo not found");
  const form = await parseForm(req);

  const channel_id = formStr(form, "channel_id") || existing.channel_id;
  const webhook_secret = formStr(form, "webhook_secret") || undefined;
  const channel = await getChannel(env.CONFIG_KV, channel_id);
  if (!channel) return errorCard("Selected channel does not exist");

  const eventValues = formAll(form, "events");
  const events = eventValues.includes("*") ? ["*"] : eventValues;

  const updated: RepoConfig = {
    ...existing,
    channel_id,
    webhook_secret,
    events,
    updated_at: now(),
  };
  await putRepo(env.CONFIG_KV, updated);
  return await reposListBody(env, panelPath);
}

export async function apiRepoDelete(env: Env, panelPath: string, fullName: string): Promise<string> {
  await deleteRepo(env.CONFIG_KV, fullName);
  return await reposListBody(env, panelPath);
}

/** Health-check endpoint used by the login form to validate the token. */
export function apiWhoami(): string {
  return "ok";
}

// ---------------------------------------------------------------------------
// Re-render helpers (return just the swap target)
// ---------------------------------------------------------------------------

async function channelsTableBody(env: Env, panelPath: string): Promise<string> {
  const [channels, repos] = await Promise.all([
    listChannels(env.CONFIG_KV),
    listRepos(env.CONFIG_KV),
  ]);
  return renderChannelsFragment({ panelPath, channels, usages: channelUsages(channels, repos) });
}

async function reposListBody(env: Env, panelPath: string): Promise<string> {
  const [repos, channels] = await Promise.all([
    listRepos(env.CONFIG_KV),
    listChannels(env.CONFIG_KV),
  ]);
  return renderReposFragment({ panelPath, repos, channels });
}

function errorCard(msg: string): string {
  return `<div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">${escapeHtml(msg)}</div>`;
}

function notFoundCard(msg: string): string {
  return `<div class="bg-ink-850 border border-ink-700 rounded-lg px-4 py-3 text-sm text-ink-400">${escapeHtml(msg)}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

function channelUsages(
  channels: ChannelConfig[],
  repos: RepoConfig[],
): Record<string, ChannelUsage> {
  const blockers: Record<string, string[]> = Object.fromEntries(channels.map((ch) => [ch.id, []]));
  for (const repo of repos) {
    blockers[repo.channel_id] ??= [];
    blockers[repo.channel_id]!.push(`repo ${repo.full_name}`);
  }

  return Object.fromEntries(channels.map((ch) => {
    const items = blockers[ch.id] ?? [];
    return [ch.id, {
      count: items.length,
      label: usageLabel(items),
      blockers: items,
    }];
  }));
}

function usageLabel(items: string[]): string {
  if (items.length === 0) return "not used";
  if (items.length <= 2) return items.join(", ");
  return `${items.slice(0, 2).join(", ")} +${items.length - 2} more`;
}
