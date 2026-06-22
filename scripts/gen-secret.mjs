#!/usr/bin/env node
/**
 * Generate panel secrets and an optional per-repo webhook secret.
 *
 * Run: pnpm gen:secret
 *      pnpm gen:secret --path   (path only)
 *
 * Put PANEL_TOKEN and PANEL_PATH into Worker secrets.
 */

import { webcrypto } from "node:crypto";

function randToken(bytes = 32) {
  return webcrypto.getRandomValues(new Uint8Array(bytes)).reduce(
    (s, b) => s + b.toString(16).padStart(2, "0"),
    "",
  );
}

function randPath() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = webcrypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `_panel_${s}`;
}

const args = new Set(process.argv.slice(2));

if (args.has("--path")) {
  console.log(randPath());
  process.exit(0);
}

console.log("# awire panel secrets — copy these into wrangler:");
console.log("#   wrangler secret put PANEL_TOKEN");
console.log("#   wrangler secret put PANEL_PATH");
console.log("");
console.log(`PANEL_TOKEN=${randToken(32)}`);
console.log(`PANEL_PATH=${randPath()}`);
console.log("");
console.log("# Optional GitHub webhook secret for a repo config:");
console.log(`WEBHOOK_SECRET=${randToken(32)}`);
