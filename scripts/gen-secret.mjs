#!/usr/bin/env node
/**
 * Generate Worker secrets and an optional per-repo webhook secret.
 *
 * Run: pnpm gen:secret
 *
 * Put PANEL_TOKEN and SESSION_SECRET into Worker secrets.
 */

import { webcrypto } from "node:crypto";

function randToken(bytes = 32) {
  return webcrypto.getRandomValues(new Uint8Array(bytes)).reduce(
    (s, b) => s + b.toString(16).padStart(2, "0"),
    "",
  );
}

console.log("# awire secrets — copy these into wrangler:");
console.log("#   wrangler secret put PANEL_TOKEN");
console.log("#   wrangler secret put SESSION_SECRET");
console.log("");
console.log(`PANEL_TOKEN=${randToken(32)}`);
console.log(`SESSION_SECRET=${randToken(32)}`);
console.log("");
console.log("# Optional GitHub webhook secret for a repo config:");
console.log(`WEBHOOK_SECRET=${randToken(32)}`);
