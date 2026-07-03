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
import { deliver } from "../delivery.ts";
import { renderCardText } from "../render/shared.ts";
import type { ChannelConfig, ChannelKind, Env, RepoConfig } from "../types.ts";
import { renderChannelsFragment, renderChannelForm, renderTestResult, type ChannelUsage } from "./fragments/channels.ts";
import { normalizeEventKeys, renderReposFragment, renderRepoForm } from "./fragments/repos.ts";

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

function formChannelKind(value: string): ChannelKind | null {
  if (value === "feishu" || value === "slack" || value === "telegram") return value;
  return null;
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
  const kind = formChannelKind(formStr(form, "kind") || "feishu");
  if (!kind) return errorCard("Channel type is invalid");
  if (!name) return errorCard("Name is required");

  const base = { id: id(), name, created_at: now(), updated_at: now() };
  let ch: ChannelConfig;
  if (kind === "telegram") {
    const bot_token = formStr(form, "bot_token");
    const chat_id = formStr(form, "chat_id");
    if (!bot_token || !chat_id) return errorCard("Telegram bot token and chat ID are required");
    ch = { ...base, kind, bot_token, chat_id };
  } else {
    const webhook_url = formStr(form, "webhook_url");
    if (!webhook_url) return errorCard("Webhook URL is required");
    if (!/^https:\/\//i.test(webhook_url)) return errorCard("Webhook URL must be HTTPS");
    ch = kind === "feishu"
      ? { ...base, kind, webhook_url, sign_secret: formStr(form, "sign_secret") || undefined }
      : { ...base, kind, webhook_url };
  }

  await putChannel(env.CONFIG_KV, ch);
  return await channelsTableBody(env, panelPath);
}

export async function apiChannelUpdate(env: Env, panelPath: string, req: Request, chId: string): Promise<string> {
  const form = await parseForm(req);
  const existing = await getChannel(env.CONFIG_KV, chId);
  if (!existing) return notFoundCard("Channel not found");

  const name = formStr(form, "name");
  const kind = formChannelKind(formStr(form, "kind") || existing.kind);
  if (!kind) return errorCard("Channel type is invalid");
  if (!name) return errorCard("Name is required");

  const base = { id: existing.id, name, kind, created_at: existing.created_at, updated_at: now() };
  let updated: ChannelConfig;
  if (kind === "telegram") {
    const botTokenValue = formStr(form, "bot_token");
    const bot_token = botTokenValue || (existing.kind === "telegram" ? existing.bot_token : "");
    const chat_id = formStr(form, "chat_id") || (existing.kind === "telegram" ? existing.chat_id : "");
    if (!bot_token || !chat_id) return errorCard("Telegram bot token and chat ID are required");
    updated = { ...base, kind, bot_token, chat_id };
  } else {
    const webhook_url = formStr(form, "webhook_url") || (existing.kind !== "telegram" ? existing.webhook_url : "");
    if (!webhook_url) return errorCard("Webhook URL is required");
    if (!/^https:\/\//i.test(webhook_url)) return errorCard("Webhook URL must be HTTPS");
    updated = kind === "feishu"
      ? { ...base, kind, webhook_url, sign_secret: formStr(form, "sign_secret") || undefined }
      : { ...base, kind, webhook_url };
  }

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

  const result = await deliver(
    ch,
    renderCardText(
      "🏓 awire test",
      `**Channel:** ${ch.name}\n**Type:** ${ch.kind}\n**Time:** ${now()}\n\nIf you see this, the delivery target is configured correctly.`,
    ),
  );
  return renderTestResult({ ok: result.ok, message: result.message, statusCode: result.statusCode });
}

export async function apiTelegramChats(req: Request): Promise<string> {
  const form = await parseForm(req);
  const botToken = formStr(form, "bot_token");
  if (!botToken) return telegramChatPicker([], "Enter a Telegram bot token first.");

  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
    const payload = await resp.json().catch(() => null);
    const data = isRecord(payload) ? payload : null;
    if (!resp.ok || data?.ok !== true) {
      return telegramChatPicker([], telegramErrorMessage(payload, resp.statusText));
    }
    const chats = extractTelegramChats(data.result);
    return telegramChatPicker(chats, chats.length === 0 ? "No chats found. Send a message to the bot, then try again." : undefined);
  } catch {
    return telegramChatPicker([], "Could not reach Telegram. Try again.");
  }
}

export interface TelegramChatOption {
  id: string;
  label: string;
  type: string;
  username?: string;
}

export function extractTelegramChats(updates: unknown): TelegramChatOption[] {
  if (!Array.isArray(updates)) return [];
  const seen = new Map<string, TelegramChatOption>();
  for (const update of updates) {
    for (const chat of telegramChatsFromUpdate(update)) {
      const id = chatId(chat);
      if (!id || seen.has(id)) continue;
      seen.set(id, {
        id,
        label: chatLabel(chat, id),
        type: chatType(chat),
        username: chatUsername(chat),
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function telegramChatsFromUpdate(update: unknown): unknown[] {
  return [
    nestedValue(update, "message", "chat"),
    nestedValue(update, "edited_message", "chat"),
    nestedValue(update, "channel_post", "chat"),
    nestedValue(update, "edited_channel_post", "chat"),
    nestedValue(update, "my_chat_member", "chat"),
    nestedValue(update, "chat_member", "chat"),
    nestedValue(update, "callback_query", "message", "chat"),
  ].filter((chat) => chat !== undefined);
}

function chatId(chat: unknown): string | undefined {
  const id = isRecord(chat) ? chat.id : undefined;
  return typeof id === "number" || typeof id === "string" ? String(id) : undefined;
}

function chatType(chat: unknown): string {
  const type = isRecord(chat) ? chat.type : undefined;
  return typeof type === "string" ? type : "chat";
}

function chatUsername(chat: unknown): string | undefined {
  const username = isRecord(chat) ? chat.username : undefined;
  return typeof username === "string" && username ? username : undefined;
}

function chatLabel(chat: unknown, fallback: string): string {
  const value = isRecord(chat) ? chat : {};
  const title = typeof value.title === "string" ? value.title : "";
  const username = typeof value.username === "string" ? `@${value.username}` : "";
  const first = typeof value.first_name === "string" ? value.first_name : "";
  const last = typeof value.last_name === "string" ? value.last_name : "";
  return title || username || [first, last].filter(Boolean).join(" ") || fallback;
}

function telegramErrorMessage(payload: unknown, fallback: string): string {
  const description = isRecord(payload) ? payload.description : undefined;
  return typeof description === "string" && description ? description : fallback;
}

function nestedValue(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function telegramChatPicker(chats: TelegramChatOption[], message?: string): string {
  const options = chats.map((chat) => {
    const username = chat.username ? ` @${chat.username}` : "";
    return `<option value="${escapeHtml(chat.id)}">${escapeHtml(`${chat.label} (${chat.type}) ${chat.id}${username}`)}</option>`;
  }).join("");
  return `
    ${message ? `<div class="text-xs text-ink-400 bg-ink-850 rounded-lg px-3 py-2">${escapeHtml(message)}</div>` : ""}
    ${chats.length > 0 ? `
      <select onchange="this.closest('[data-channel-kind]').querySelector('input[name=chat_id]').value=this.value"
              class="mt-2 w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent">
        <option value="">Select a discovered chat...</option>
        ${options}
      </select>` : ""}
  `;
}

export async function apiRepoCreate(env: Env, panelPath: string, req: Request): Promise<string> {
  const form = await parseForm(req);
  const full_name = formRepoFullName(form);
  const channel_id = formStr(form, "channel_id");
  const webhook_secret = formStr(form, "webhook_secret") || undefined;

  if (!full_name) return errorCard("Repository (owner/name or owner/*) is required");
  if (!channel_id) return errorCard("Target channel is required");
  if (!/^[A-Za-z0-9._-]+\/(?:[A-Za-z0-9._-]+|\*)$/.test(full_name)) {
    return errorCard("Repository must be in 'owner/name' or 'owner/*' format");
  }
  const channel = await getChannel(env.CONFIG_KV, channel_id);
  if (!channel) return errorCard("Selected channel does not exist");

  const events = normalizeEventKeys(formAll(form, "events"));

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

function formRepoFullName(form: FormData): string {
  const explicit = formStr(form, "full_name");
  if (explicit) return explicit;
  const owner = formStr(form, "owner");
  if (!owner) return "";
  if (formStr(form, "route_scope") === "owner") return `${owner}/*`;
  const repo = formStr(form, "repo_name");
  return repo ? `${owner}/${repo}` : "";
}

export async function apiRepoUpdate(env: Env, panelPath: string, req: Request, fullName: string): Promise<string> {
  const existing = await getRepo(env.CONFIG_KV, fullName);
  if (!existing) return notFoundCard("Repo not found");
  const form = await parseForm(req);

  const channel_id = formStr(form, "channel_id") || existing.channel_id;
  const webhook_secret = formStr(form, "webhook_secret") || undefined;
  const channel = await getChannel(env.CONFIG_KV, channel_id);
  if (!channel) return errorCard("Selected channel does not exist");

  const events = normalizeEventKeys(formAll(form, "events"));

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
