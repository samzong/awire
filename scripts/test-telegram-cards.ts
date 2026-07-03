/// <reference types="node" />

import { deliver } from "../src/delivery.ts";
import { extractTelegramChats } from "../src/panel/api.ts";
import type { ChannelConfig } from "../src/types.ts";
import { envValue, renderSmokeCard, sleep, smokeCases } from "./card-smoke-fixtures.ts";

const dryRun = process.env.TG_DRY_RUN === "1";
const botToken = envValue("TG_BOT_TOKEN", "TELEGRAM_BOT_TOKEN");
const chatId = envValue("TG_CHAT_ID", "TELEGRAM_CHAT_ID");
const delayMs = Number(process.env.TG_DELAY_MS ?? "350");

if (!dryRun) {
  const missing = [
    botToken ? "" : "TG_BOT_TOKEN",
    chatId ? "" : "TG_CHAT_ID",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`missing ${missing.join(", ")} in .dev.vars`);
    process.exit(1);
  }
}

const channel: ChannelConfig = {
  id: "telegram-smoke",
  name: "Telegram smoke",
  kind: "telegram",
  bot_token: botToken,
  chat_id: chatId,
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
    if (result.message.toLowerCase().includes("chat not found")) await printVisibleChats(botToken);
    throw new Error(
      `telegram send failed for ${sample.label}: http=${result.httpStatus} code=${result.statusCode ?? "-"} ${result.message}`,
    );
  }
  console.log(`sent ${index + 1}/${smokeCases.length} ${sample.label}`);
  if (delayMs > 0 && index < smokeCases.length - 1) await sleep(delayMs);
}

console.log(dryRun ? `telegram smoke dry-run ok (${smokeCases.length} cards)` : `telegram smoke sent ${smokeCases.length} cards`);

async function printVisibleChats(token: string): Promise<void> {
  const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const payload = await resp.json().catch(() => undefined) as { ok?: boolean; result?: unknown[]; description?: string } | undefined;
  if (!resp.ok || payload?.ok !== true) {
    console.error(`could not discover Telegram chats: ${payload?.description ?? resp.statusText}`);
    return;
  }

  const chats = extractTelegramChats(payload.result ?? []);
  if (chats.length === 0) {
    console.error("bot sees no chats yet; send a message to the bot or add it to the group/channel, then rerun");
    return;
  }

  console.error("bot can see these chats:");
  for (const chat of chats) {
    const username = chat.username ? ` @${chat.username}` : "";
    console.error(`- ${chat.id} ${chat.type} ${chat.label}${username}`);
  }
}
