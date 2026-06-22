#!/usr/bin/env node
/**
 * Smoke test: send a signed, realistic GitHub webhook payload to a local
 * or deployed awire worker and verify the response.
 *
 * Usage:
 *   URL=http://localhost:8787 SECRET=xxx pnpm test:webhook
 *   URL=https://awire.<acct>.workers.dev SECRET=xxx EVENT=issues_opened pnpm test:webhook
 *
 * Loads samples from ./samples/*.json (created on first run if missing).
 */

import { webcrypto } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "samples");

const URL_ = process.env.URL ?? "http://localhost:8787";
const SECRET = process.env.SECRET ?? "";
const EVENT = process.env.EVENT ?? "issues_opened";
const DELIVERY = process.env.DELIVERY ?? `smoke-${Date.now()}`;

if (!SECRET) {
  console.error("Set SECRET=<repo webhook secret>");
  process.exit(1);
}

function loadSample(name) {
  if (!existsSync(SAMPLES_DIR)) mkdirSync(SAMPLES_DIR, { recursive: true });
  const file = join(SAMPLES_DIR, `${name}.json`);
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(DEFAULT_SAMPLES[name] ?? { zen: "hello", repository: { full_name: "octocat/Hello-World", html_url: "https://github.com/octocat/Hello-World" }, sender: { login: "octocat", html_url: "https://github.com/octocat" } }, null, 2));
  }
  return readFileSync(file, "utf8");
}

async function sign(body) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

const body = loadSample(EVENT);
const signature = await sign(body);

console.log(`→ POST ${URL_}/hook/github`);
console.log(`  X-GitHub-Event: ${EVENT.replace(/_.+$/, "")}`);
console.log(`  X-GitHub-Delivery: ${DELIVERY}`);

const resp = await fetch(`${URL_}/hook/github`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": EVENT.replace(/_.+$/, ""),
    "X-GitHub-Delivery": DELIVERY,
    "X-Hub-Signature-256": signature,
  },
  body,
});

const text = await resp.text();
console.log(`← ${resp.status}`);
console.log(`  ${text}`);

if (resp.status >= 200 && resp.status < 300) {
  console.log("✅ ok");
  process.exit(0);
} else {
  console.log("❌ failed");
  process.exit(1);
}

const DEFAULT_SAMPLES = {
  ping: {
    zen: "Keep it logically awesome.",
    hook_id: 42,
    repository: { full_name: "octocat/Hello-World", name: "Hello-World", html_url: "https://github.com/octocat/Hello-World" },
    sender: { login: "octocat", html_url: "https://github.com/octocat" },
  },
  issues_opened: {
    action: "opened",
    issue: { number: 42, title: "Add login page", body: "Need a login form.", html_url: "https://github.com/octocat/Hello-World/issues/42", state: "open", user: { login: "octocat", html_url: "https://github.com/octocat" } },
    repository: { full_name: "octocat/Hello-World", name: "Hello-World", html_url: "https://github.com/octocat/Hello-World" },
    sender: { login: "octocat", html_url: "https://github.com/octocat" },
  },
  pull_request_opened: {
    action: "opened",
    number: 42,
    pull_request: { number: 42, title: "feat: add login", body: "Implementing login flow.", html_url: "https://github.com/octocat/Hello-World/pull/42", state: "open", draft: false, merged: false, user: { login: "octocat", html_url: "https://github.com/octocat" }, head: { ref: "feat/login" }, base: { ref: "main" } },
    repository: { full_name: "octocat/Hello-World", name: "Hello-World", html_url: "https://github.com/octocat/Hello-World" },
    sender: { login: "octocat", html_url: "https://github.com/octocat" },
  },
  pull_request_closed_merged: {
    action: "closed",
    number: 42,
    pull_request: { number: 42, title: "feat: add login", body: null, html_url: "https://github.com/octocat/Hello-World/pull/42", state: "closed", draft: false, merged: true, merged_at: "2026-06-22T00:00:00Z", user: { login: "octocat", html_url: "https://github.com/octocat" }, head: { ref: "feat/login" }, base: { ref: "main" } },
    repository: { full_name: "octocat/Hello-World", name: "Hello-World", html_url: "https://github.com/octocat/Hello-World" },
    sender: { login: "octocat", html_url: "https://github.com/octocat" },
  },
};
