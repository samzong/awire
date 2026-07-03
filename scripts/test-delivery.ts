/// <reference types="node" />

import assert from "node:assert/strict";
import { cardToSlackPayload, cardToTelegramPayload, cardToTelegramText, deliver } from "../src/delivery.ts";
import { apiTelegramChats, extractTelegramChats } from "../src/panel/api.ts";
import { renderChannelForm, renderChannelsFragment } from "../src/panel/fragments/channels.ts";
import { actionButton, renderCardText } from "../src/render/shared.ts";

const card = renderCardText(
  "awire test",
  "**Repo:** [octocat/Hello-World](https://github.com/octocat/Hello-World)\n> [#1 Preview](https://github.com/octocat/Hello-World/pull/1)\n*PR · open*\n**Branch:** `main`",
);
card.elements.push(actionButton("https://github.com/octocat/Hello-World", "View on GitHub"));

const slackPayload = cardToSlackPayload(card);
const slackText = JSON.stringify(slackPayload);
assert.match(slackText, /<https:\/\/github\.com\/octocat\/Hello-World\|octocat\/Hello-World>/);
assert.match(slackText, /\*Repo:\*/);
assert.match(slackText, /View on GitHub/);

const telegramText = cardToTelegramText(card);
assert.match(telegramText, /<b>awire test<\/b>/);
assert.match(telegramText, /<b>Repo:<\/b> octocat\/Hello-World/);
assert.match(telegramText, /<blockquote>#1 Preview<\/blockquote>/);
assert.match(telegramText, /<i>PR · open<\/i>/);
assert.match(telegramText, /<b>Branch:<\/b> <code>main<\/code>/);

const telegramPayload = cardToTelegramPayload("@alerts", card);
assert.equal(telegramPayload.parse_mode, "HTML");
assert.deepEqual(telegramPayload.link_preview_options, { is_disabled: true });
assert.deepEqual(telegramPayload.reply_markup, {
  inline_keyboard: [[
    { text: "View on GitHub", url: "https://github.com/octocat/Hello-World" },
    { text: "#1 Preview", url: "https://github.com/octocat/Hello-World/pull/1" },
  ]],
});

const discoveredChats = extractTelegramChats([
  { message: { chat: { id: 42, type: "private", first_name: "Sam" }, text: "secret text" } },
  { channel_post: { chat: { id: -100123, type: "channel", title: "Deploys", username: "deploys" }, text: "do not return" } },
  { edited_message: { chat: { id: 42, type: "private", first_name: "Sam" } } },
]);
assert.deepEqual(discoveredChats, [
  { id: "-100123", label: "Deploys", type: "channel", username: "deploys" },
  { id: "42", label: "Sam", type: "private", username: undefined },
]);

const formHtml = renderChannelForm({ panelPath: "/panel" });
assert.ok(formHtml.includes('hx-post="/panel/api/telegram/chats"'));
assert.ok(formHtml.includes("Discover chats"));

const channelsHtml = renderChannelsFragment({
  panelPath: "/panel",
  channels: [{
    id: "slack-test",
    name: "Slack test",
    kind: "slack",
    webhook_url: "https://example.invalid/services/example-team/example-bot/example-secret",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }],
});
assert.ok(channelsHtml.includes("https://example.invalid/services/exam…cret"));
assert.doesNotMatch(channelsHtml, /example-team/);
assert.doesNotMatch(channelsHtml, /example-bot/);

const fetchBeforeDiscover = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  assert.equal(String(input), "https://api.telegram.org/botTOKEN/getUpdates");
  return new Response(JSON.stringify({
    ok: true,
    result: [{ message: { chat: { id: 42, type: "private", first_name: "Sam" }, text: "must not leak" } }],
  }));
}) as typeof fetch;
try {
  const html = await apiTelegramChats(new Request("https://awire.test", {
    method: "POST",
    body: new URLSearchParams({ bot_token: "TOKEN" }),
  }));
  assert.match(html, /Select a discovered chat/);
  assert.ok(html.includes("Sam (private) 42"));
  assert.doesNotMatch(html, /must not leak/);
} finally {
  globalThis.fetch = fetchBeforeDiscover;
}

const missingChat = await deliver({
  id: "telegram-test",
  name: "Telegram test",
  kind: "telegram",
  bot_token: "TOKEN",
  chat_id: "",
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
}, card);
assert.equal(missingChat.ok, false);
assert.equal(missingChat.provider, "telegram");
assert.equal(missingChat.message, "telegram chat_id is required");

const missingToken = await deliver({
  id: "telegram-test",
  name: "Telegram test",
  kind: "telegram",
  bot_token: "",
  chat_id: "@alerts",
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
}, card);
assert.equal(missingToken.ok, false);
assert.equal(missingToken.message, "telegram bot token is required");

const originalFetch = globalThis.fetch;
let telegramBody: Record<string, unknown> | undefined;
let telegramUrl = "";
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  telegramUrl = String(input);
  telegramBody = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ ok: true }), { status: 200, statusText: "OK" });
}) as typeof fetch;
try {
  const sent = await deliver({
    id: "telegram-test",
    name: "Telegram test",
    kind: "telegram",
    bot_token: "TOKEN",
    chat_id: "@alerts",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }, card);
  assert.equal(sent.ok, true);
  assert.equal(telegramUrl, "https://api.telegram.org/botTOKEN/sendMessage");
  assert.deepEqual(Object.keys(telegramBody ?? {}).sort(), ["chat_id", "link_preview_options", "parse_mode", "reply_markup", "text"]);
  assert.equal(telegramBody?.chat_id, "@alerts");
  assert.equal(telegramBody?.parse_mode, "HTML");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("delivery self-check ok");
