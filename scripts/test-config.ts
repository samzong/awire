import assert from "node:assert/strict";

import { putChannel, putRepo, resolveRoute } from "../src/config.ts";
import type { ChannelConfig, RepoConfig } from "../src/types.ts";

class MemoryKV {
  private readonly store = new Map<string, string>();

  async get<T>(key: string, type?: "json"): Promise<T | string | null> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    return type === "json" ? JSON.parse(raw) as T : raw;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const kv = new MemoryKV() as unknown as KVNamespace;
const created_at = new Date(0).toISOString();
const updated_at = created_at;

const wildcardChannel: ChannelConfig = {
  id: "wildcard",
  name: "Wildcard",
  kind: "feishu",
  webhook_url: "https://example.com/wildcard",
  created_at,
  updated_at,
};
const exactChannel: ChannelConfig = {
  id: "exact",
  name: "Exact",
  kind: "feishu",
  webhook_url: "https://example.com/exact",
  created_at,
  updated_at,
};

await putChannel(kv, wildcardChannel);
await putChannel(kv, exactChannel);
await putRepo(kv, repo("samzong/*", wildcardChannel.id, ["issues.opened"]));
await putRepo(kv, repo("samzong/awire", exactChannel.id, ["pull_request.opened"]));

const wildcard = await resolveRoute(kv, "samzong/new-repo");
assert.equal(wildcard?.channel.id, "wildcard");
assert.deepEqual(wildcard?.events, ["issues.opened"]);

const exact = await resolveRoute(kv, "samzong/awire");
assert.equal(exact?.channel.id, "exact");
assert.deepEqual(exact?.events, ["pull_request.opened"]);

assert.equal(await resolveRoute(kv, "other/repo"), null);

console.log("config route smoke ok");

function repo(full_name: string, channel_id: string, events: string[]): RepoConfig {
  return {
    full_name,
    channel_id,
    events,
    created_at,
    updated_at,
  };
}
