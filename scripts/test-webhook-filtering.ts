import assert from "node:assert/strict";
import worker from "../src/index.ts";
import type { Env } from "../src/types.ts";
import { smokeCases } from "./card-smoke-fixtures.ts";

const store = new Map<string, string>();
const kv = {
  async get(key: string, type?: string) {
    const value = store.get(key);
    return value === undefined ? null : type === "json" ? JSON.parse(value) : value;
  },
  async put(key: string, value: string) {
    store.set(key, value);
  },
} as unknown as KVNamespace;
const env: Env = {
  CONFIG_KV: kv,
  DEDUP_KV: kv,
  PANEL_TOKEN: "",
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  SESSION_SECRET: "",
};
await kv.put("channel:test", JSON.stringify({
  id: "test", name: "Test", kind: "feishu", webhook_url: "https://mock.invalid/notification",
}));

const cases = [
  { fixture: "pull_request.opened", draft: true, sends: 0 },
  { fixture: "pull_request.opened", action: "converted_to_draft", draft: true, sends: 0 },
  { fixture: "pull_request.opened", action: "closed", draft: true, sends: 0 },
  { fixture: "pull_request_review.submitted", draft: true, sends: 0 },
  { fixture: "pull_request_review_comment.created", draft: true, sends: 0 },
  { fixture: "pull_request.opened", draft: false, sends: 1 },
  { fixture: "pull_request.opened", action: "ready_for_review", draft: false, sends: 1 },
  { fixture: "pull_request.opened", action: "ready_for_review", draft: false, events: ["pull_request.opened"], sends: 0 },
  { fixture: "pull_request_review.submitted", draft: false, sends: 1 },
  { fixture: "pull_request_review_comment.created", draft: false, sends: 1 },
  { fixture: "issue_comment.created", sends: 1 },
  { fixture: "issues.opened", sends: 1 },
];

const originalFetch = globalThis.fetch;
let sends = 0;
globalThis.fetch = async (input) => {
  assert.equal(String(input), "https://mock.invalid/notification");
  sends++;
  return Response.json({ code: 0 });
};
try {
  for (const [index, test] of cases.entries()) {
    const fixture = smokeCases.find(({ label }) => label === test.fixture);
    assert.ok(fixture);
    const payload = structuredClone(fixture.payload);
    payload.action = test.action ?? fixture.action;
    if (payload.pull_request && test.draft !== undefined) payload.pull_request.draft = test.draft;
    await kv.put(`repo:${payload.repository.full_name}`, JSON.stringify({
      full_name: payload.repository.full_name, channel_id: "test", events: test.events ?? ["*"],
    }));
    const before = sends;
    const response = await worker.fetch(new Request("https://awire.test/hook/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": fixture.event,
        "X-GitHub-Delivery": `filter-test-${index}`,
      },
      body: JSON.stringify(payload),
    }), env);
    const label = `${fixture.event}.${payload.action} draft=${test.draft}`;
    assert.equal(response.status, 200, label);
    assert.equal(sends - before, test.sends, label);
    assert.deepEqual(await response.json(), test.sends ? { ok: true } : { ok: true, filtered: true }, label);
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log(`webhook filtering self-check ok (${cases.length} cases, no external requests)`);
