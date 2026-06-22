/**
 * Configuration loader + event filtering.
 *
 * Storage strategy (KV index pattern):
 *   "channels:index" -> string[]
 *   "channel:<id>"   -> ChannelConfig
 *   "repos:index"    -> string[]            (lowercase "owner/name")
 *   "repo:<full>"    -> RepoConfig
 *
 * The webhook hot path only needs to resolve ONE repo's config. That's a
 * single KV.get — ~ms at the edge.
 *
 * The panel needs to list all repos / channels. For that we keep the index
 * keys. Lists are bounded by the user's fleet size (dozens to hundreds), so
 * fan-out reads after fetching the index are acceptable.
 */

import type {
  ChannelConfig,
  RepoConfig,
} from "./types.ts";

// ===========================================================================
// KEYS
// ===========================================================================

const K_ChannelsIndex = "channels:index";
const K_ReposIndex = "repos:index";

const channelKey = (id: string) => `channel:${id}`;
const repoKey = (full: string) => `repo:${full.toLowerCase()}`;

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
 *
 */
export async function resolveRoute(
  configKv: KVNamespace,
  repoFullName: string,
): Promise<ResolvedRoute | null> {
  const repoCfg = await getRepo(configKv, repoFullName);
  if (repoCfg) {
    const channel = await getChannel(configKv, repoCfg.channel_id);
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
): Promise<ChannelConfig | null> {
  const raw = await configKv.get(channelKey(id), "json");
  return (raw ?? null) as ChannelConfig | null;
}

export async function getRepo(
  configKv: KVNamespace,
  fullName: string,
): Promise<RepoConfig | null> {
  const raw = await configKv.get(repoKey(fullName), "json");
  return (raw ?? null) as RepoConfig | null;
}

export async function listChannels(
  configKv: KVNamespace,
): Promise<ChannelConfig[]> {
  const ids = (await configKv.get<string[]>(K_ChannelsIndex, "json")) ?? [];
  const out: ChannelConfig[] = [];
  for (const id of ids) {
    const ch = await getChannel(configKv, id);
    if (ch) out.push(ch);
  }
  // Stable ordering by name.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function listRepos(
  configKv: KVNamespace,
): Promise<RepoConfig[]> {
  const names = (await configKv.get<string[]>(K_ReposIndex, "json")) ?? [];
  const out: RepoConfig[] = [];
  for (const name of names) {
    const r = await getRepo(configKv, name);
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
): Promise<void> {
  await configKv.put(channelKey(channel.id), JSON.stringify(channel));
  const ids = (await configKv.get<string[]>(K_ChannelsIndex, "json")) ?? [];
  if (!ids.includes(channel.id)) {
    ids.push(channel.id);
    await configKv.put(K_ChannelsIndex, JSON.stringify(ids));
  }
}

export async function deleteChannel(
  configKv: KVNamespace,
  id: string,
): Promise<void> {
  await configKv.delete(channelKey(id));
  const ids = (await configKv.get<string[]>(K_ChannelsIndex, "json")) ?? [];
  const next = ids.filter((x) => x !== id);
  if (next.length !== ids.length) {
    await configKv.put(K_ChannelsIndex, JSON.stringify(next));
  }
}

export async function putRepo(
  configKv: KVNamespace,
  repo: RepoConfig,
): Promise<void> {
  const key = repoKey(repo.full_name);
  await configKv.put(key, JSON.stringify(repo));
  const names = (await configKv.get<string[]>(K_ReposIndex, "json")) ?? [];
  if (!names.includes(repo.full_name.toLowerCase())) {
    names.push(repo.full_name.toLowerCase());
    await configKv.put(K_ReposIndex, JSON.stringify(names));
  }
}

export async function deleteRepo(
  configKv: KVNamespace,
  fullName: string,
): Promise<void> {
  const key = repoKey(fullName);
  await configKv.delete(key);
  const names = (await configKv.get<string[]>(K_ReposIndex, "json")) ?? [];
  const next = names.filter((x) => x !== fullName.toLowerCase());
  if (next.length !== names.length) {
    await configKv.put(K_ReposIndex, JSON.stringify(next));
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
