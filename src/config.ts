/**
 * Configuration loader + event filtering.
 *
 * Storage strategy (KV index pattern):
 *   "account:<id>:channels:index" -> string[]
 *   "account:<id>:channel:<id>"   -> ChannelConfig
 *   "account:<id>:repos:index"    -> string[]            (lowercase "owner/name" or "owner/*")
 *   "account:<id>:repo:<full>"    -> RepoConfig
 *
 * The webhook hot path first checks an exact repo route, then an owner wildcard.
 *
 * The panel needs to list all repos / channels. For that we keep the index
 * keys. Lists are bounded by the user's fleet size (dozens to hundreds), so
 * fan-out reads after fetching the index are acceptable.
 */

import type {
  ChannelConfig,
  ChannelKind,
  RepoConfig,
} from "./types.ts";

type StoredChannelConfig = {
  id: string;
  name: string;
  kind?: ChannelKind;
  webhook_url?: string;
  sign_secret?: string;
  bot_token?: string;
  chat_id?: string;
  created_at: string;
  updated_at: string;
};

// ===========================================================================
// KEYS
// ===========================================================================

const prefix = (accountId: string | undefined) => accountId ? `account:${accountId}:` : "";
const channelsIndexKey = (accountId?: string) => `${prefix(accountId)}channels:index`;
const reposIndexKey = (accountId?: string) => `${prefix(accountId)}repos:index`;
const channelKey = (id: string, accountId?: string) => `${prefix(accountId)}channel:${id}`;
const repoKey = (full: string, accountId?: string) => `${prefix(accountId)}repo:${full.toLowerCase()}`;

// ===========================================================================
// READ - webhook hot path (single resolution)
// ===========================================================================

export interface ResolvedRoute {
  channel: ChannelConfig;
  events: string[];
  webhook_secret?: string;
}

/**
 * Resolve a repo to its target channel + event allow-list.
 */
export async function resolveRoute(
  configKv: KVNamespace,
  repoFullName: string,
  accountId?: string,
): Promise<ResolvedRoute | null> {
  const repoCfg = await getRepo(configKv, repoFullName, accountId) ?? await getOwnerWildcardRepo(configKv, repoFullName, accountId);
  if (repoCfg) {
    const channel = await getChannel(configKv, repoCfg.channel_id, accountId);
    if (!channel) return null;
    return { channel, events: repoCfg.events, webhook_secret: repoCfg.webhook_secret };
  }

  return null;
}

// ===========================================================================
// READ - individual getters
// ===========================================================================

export async function getChannel(
  configKv: KVNamespace,
  id: string,
  accountId?: string,
): Promise<ChannelConfig | null> {
  const raw = await configKv.get(channelKey(id, accountId), "json");
  return normalizeChannel((raw ?? null) as StoredChannelConfig | null);
}

export async function getRepo(
  configKv: KVNamespace,
  fullName: string,
  accountId?: string,
): Promise<RepoConfig | null> {
  const raw = await configKv.get(repoKey(fullName, accountId), "json");
  return (raw ?? null) as RepoConfig | null;
}

async function getOwnerWildcardRepo(
  configKv: KVNamespace,
  fullName: string,
  accountId?: string,
): Promise<RepoConfig | null> {
  const slash = fullName.indexOf("/");
  if (slash <= 0) return null;
  return await getRepo(configKv, `${fullName.slice(0, slash)}/*`, accountId);
}

export async function listChannels(
  configKv: KVNamespace,
  accountId?: string,
): Promise<ChannelConfig[]> {
  const ids = (await configKv.get<string[]>(channelsIndexKey(accountId), "json")) ?? [];
  const out: ChannelConfig[] = [];
  for (const id of ids) {
    const ch = await getChannel(configKv, id, accountId);
    if (ch) out.push(ch);
  }
  // Stable ordering by name.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function listRepos(
  configKv: KVNamespace,
  accountId?: string,
): Promise<RepoConfig[]> {
  const names = (await configKv.get<string[]>(reposIndexKey(accountId), "json")) ?? [];
  const out: RepoConfig[] = [];
  for (const name of names) {
    const r = await getRepo(configKv, name, accountId);
    if (r) out.push(r);
  }
  out.sort((a, b) => a.full_name.localeCompare(b.full_name));
  return out;
}

// ===========================================================================
// WRITE - used by the panel API
// ===========================================================================

export async function putChannel(
  configKv: KVNamespace,
  channel: ChannelConfig,
  accountId?: string,
): Promise<void> {
  await configKv.put(channelKey(channel.id, accountId), JSON.stringify(channel));
  const indexKey = channelsIndexKey(accountId);
  const ids = (await configKv.get<string[]>(indexKey, "json")) ?? [];
  if (!ids.includes(channel.id)) {
    ids.push(channel.id);
    await configKv.put(indexKey, JSON.stringify(ids));
  }
}

function normalizeChannel(channel: StoredChannelConfig | null): ChannelConfig | null {
  if (!channel) return null;
  const kind = channel.kind ?? "feishu";
  if (kind === "telegram") {
    const bot_token = typeof channel.bot_token === "string"
      ? channel.bot_token
      : telegramTokenFromWebhook(typeof channel.webhook_url === "string" ? channel.webhook_url : "");
    return {
      id: channel.id,
      name: channel.name,
      kind,
      bot_token: bot_token ?? "",
      chat_id: channel.chat_id ?? "",
      created_at: channel.created_at,
      updated_at: channel.updated_at,
    };
  }
  return {
    id: channel.id,
    name: channel.name,
    kind,
    webhook_url: channel.webhook_url ?? "",
    ...(kind === "feishu" && channel.sign_secret ? { sign_secret: channel.sign_secret } : {}),
    created_at: channel.created_at,
    updated_at: channel.updated_at,
  };
}

function telegramTokenFromWebhook(url: string): string | undefined {
  return url.match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/sendMessage$/i)?.[1];
}

export async function deleteChannel(
  configKv: KVNamespace,
  id: string,
  accountId?: string,
): Promise<void> {
  await configKv.delete(channelKey(id, accountId));
  const indexKey = channelsIndexKey(accountId);
  const ids = (await configKv.get<string[]>(indexKey, "json")) ?? [];
  const next = ids.filter((x) => x !== id);
  if (next.length !== ids.length) {
    await configKv.put(indexKey, JSON.stringify(next));
  }
}

export async function putRepo(
  configKv: KVNamespace,
  repo: RepoConfig,
  accountId?: string,
): Promise<void> {
  const key = repoKey(repo.full_name, accountId);
  await configKv.put(key, JSON.stringify(repo));
  const indexKey = reposIndexKey(accountId);
  const names = (await configKv.get<string[]>(indexKey, "json")) ?? [];
  if (!names.includes(repo.full_name.toLowerCase())) {
    names.push(repo.full_name.toLowerCase());
    await configKv.put(indexKey, JSON.stringify(names));
  }
}

export async function deleteRepo(
  configKv: KVNamespace,
  fullName: string,
  accountId?: string,
): Promise<void> {
  const key = repoKey(fullName, accountId);
  await configKv.delete(key);
  const indexKey = reposIndexKey(accountId);
  const names = (await configKv.get<string[]>(indexKey, "json")) ?? [];
  const next = names.filter((x) => x !== fullName.toLowerCase());
  if (next.length !== names.length) {
    await configKv.put(indexKey, JSON.stringify(next));
  }
}

// ===========================================================================
// EVENT FILTER
// ===========================================================================

/**
 * Decide whether an event/action should be forwarded, given the repo's
 * configured allow-list.
 *
 * Match rules (in order):
 *   1. allow-list contains "*" -> forward everything
 *   2. allow-list contains "<event>" -> forward all actions of this event
 *   3. allow-list contains "<event>.<action>" -> forward this specific action
 *   4. otherwise -> filter out
 */
export function shouldForward(
  allowList: string[],
  event: string,
  action: string | undefined,
): boolean {
  if (allowList.includes("*")) return true;
  if (allowList.includes(event)) return true;
  if (action && allowList.includes(`${event}.${action}`)) return true;
  return false;
}
