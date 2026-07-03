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
const otherAccountChannel: ChannelConfig = {
  id: "other-account",
  name: "Other account",
  kind: "feishu",
  webhook_url: "https://example.com/other-account",
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

await putChannel(kv, exactChannel, "gh_1");
await putRepo(kv, repo("shared/repo", exactChannel.id, ["pull_request.opened"]), "gh_1");
await putChannel(kv, otherAccountChannel, "gh_2");
await putRepo(kv, repo("shared/repo", otherAccountChannel.id, ["issues.opened"]), "gh_2");

const accountOne = await resolveRoute(kv, "shared/repo", "gh_1");
assert.equal(accountOne?.channel.id, "exact");
assert.deepEqual(accountOne?.events, ["pull_request.opened"]);

const accountTwo = await resolveRoute(kv, "shared/repo", "gh_2");
assert.equal(accountTwo?.channel.id, "other-account");
assert.deepEqual(accountTwo?.events, ["issues.opened"]);

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
