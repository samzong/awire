/// <reference types="node" />

import { deliver } from "../src/delivery.ts";
import type { ChannelConfig } from "../src/types.ts";
import { envValue, renderSmokeCard, sleep, smokeCases } from "./card-smoke-fixtures.ts";

const dryRun = process.env.SLACK_DRY_RUN === "1";
const webhookUrl = envValue("SLACK_WEBHOOK_URL", "SLACK_URL");
const delayMs = Number(process.env.SLACK_DELAY_MS ?? "350");

if (!dryRun && !webhookUrl) {
  console.error("missing SLACK_WEBHOOK_URL in .dev.vars");
  process.exit(1);
}

const channel: ChannelConfig = {
  id: "slack-smoke",
  name: "Slack smoke",
  kind: "slack",
  webhook_url: webhookUrl,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

for (const [index, sample] of smokeCases.entries()) {
  const card = renderSmokeCard(sample, "awire smoke");

  if (dryRun) {
    console.log(`dry ${index + 1}/${smokeCases.length} ${sample.label}`);
    continue;
  }

  const result = await deliver(channel, card);
  if (!result.ok) {
    throw new Error(`slack send failed for ${sample.label}: http=${result.httpStatus} ${result.message}`);
  }
  console.log(`sent ${index + 1}/${smokeCases.length} ${sample.label}`);
  if (delayMs > 0 && index < smokeCases.length - 1) await sleep(delayMs);
}

console.log(dryRun ? `slack smoke dry-run ok (${smokeCases.length} cards)` : `slack smoke sent ${smokeCases.length} cards`);
