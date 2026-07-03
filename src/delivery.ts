import { sendCard } from "./feishu.ts";
import type { ChannelConfig, ChannelKind, FeishuCard } from "./types.ts";

export interface DeliveryResult {
  ok: boolean;
  statusCode: number | null;
  message: string;
  httpStatus: number;
  provider: ChannelKind;
}

export async function deliver(channel: ChannelConfig, card: FeishuCard): Promise<DeliveryResult> {
  if (channel.kind === "feishu") {
    return { ...(await sendCard(channel.webhook_url, card, channel.sign_secret)), provider: channel.kind };
  }
  if (channel.kind === "slack") return await sendSlack(channel.webhook_url, card);
  return await sendTelegram(channel.bot_token, channel.chat_id, card);
}

export function cardToSlackPayload(card: FeishuCard): { text: string; blocks: unknown[] } {
  const title = card.header.title.content;
  const body = cardBody(card, toSlackText);
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: truncate(title, 150) } },
  ];
  if (body) blocks.push({ type: "section", text: { type: "mrkdwn", text: body } });
  const buttons = cardButtons(card).slice(0, 5);
  if (buttons.length > 0) {
    blocks.push({
      type: "actions",
      elements: buttons.map((button) => ({
        type: "button",
        text: { type: "plain_text", text: truncate(button.label, 75) },
        url: button.url,
      })),
    });
  }
  return { text: [title, body].filter(Boolean).join("\n\n"), blocks };
}

export function cardToTelegramText(card: FeishuCard): string {
  const title = card.header.title.content;
  const body = cardBody(card, toTelegramHtml);
  const html = [`<b>${escapeHtml(title)}</b>`, body].filter(Boolean).join("\n\n");
  if (html.length <= 4096) return html;
  return escapeHtml(truncate([title, cardBody(card, toPlainText)].filter(Boolean).join("\n\n"), 4096));
}

export function cardToTelegramPayload(chatId: string, card: FeishuCard): Record<string, unknown> {
  const inline_keyboard = telegramInlineKeyboard(card);
  return {
    chat_id: chatId,
    text: cardToTelegramText(card),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(inline_keyboard.length > 0
      ? { reply_markup: { inline_keyboard } }
      : {}),
  };
}

async function sendSlack(webhookUrl: string, card: FeishuCard): Promise<DeliveryResult> {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(cardToSlackPayload(card)),
  });
  const message = await resp.text().catch(() => resp.statusText);
  return {
    ok: resp.ok && message.trim() === "ok",
    statusCode: null,
    message: message || resp.statusText,
    httpStatus: resp.status,
    provider: "slack",
  };
}

async function sendTelegram(
  botToken: string,
  chatId: string | undefined,
  card: FeishuCard,
): Promise<DeliveryResult> {
  if (!botToken) {
    return {
      ok: false,
      statusCode: null,
      message: "telegram bot token is required",
      httpStatus: 0,
      provider: "telegram",
    };
  }
  if (!chatId) {
    return {
      ok: false,
      statusCode: null,
      message: "telegram chat_id is required",
      httpStatus: 0,
      provider: "telegram",
    };
  }

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(cardToTelegramPayload(chatId, card)),
  });
  let payload: { ok?: boolean; error_code?: number; description?: string } = {};
  try {
    payload = await resp.json();
  } catch {
    payload = {};
  }
  return {
    ok: resp.ok && payload.ok === true,
    statusCode: payload.error_code ?? null,
    message: payload.description ?? resp.statusText,
    httpStatus: resp.status,
    provider: "telegram",
  };
}

function cardBody(card: FeishuCard, mapText: (value: string) => string): string {
  const parts: string[] = [];
  for (const element of card.elements) {
    if (element.tag === "div") parts.push(mapText(element.text.content));
    if (element.tag === "note") {
      const note = element.elements.map((item) => mapText(item.content)).join(" ");
      if (note) parts.push(note);
    }
    if (element.tag === "hr") parts.push("---");
  }
  return parts.filter(Boolean).join("\n\n");
}

function cardButtons(card: FeishuCard): { label: string; url: string }[] {
  const buttons: { label: string; url: string }[] = [];
  for (const element of card.elements) {
    if (element.tag !== "action") continue;
    for (const action of element.actions) {
      buttons.push({ label: action.text.content, url: action.url });
    }
  }
  return buttons;
}

function telegramInlineKeyboard(card: FeishuCard): { text: string; url: string }[][] {
  const seen = new Set<string>();
  const rows: { text: string; url: string }[][] = [];
  const add = (label: string, url: string) => {
    if (!label || !url || seen.has(url) || seen.size >= 8) return;
    seen.add(url);
    if (rows.length === 0 || rows[rows.length - 1]!.length === 2) rows.push([]);
    rows[rows.length - 1]!.push({
      text: truncate(label.replace(/\\([\\[\]*_~])/g, "$1").replace(/\s+/g, " ").trim(), 64),
      url,
    });
  };

  for (const button of cardButtons(card)) add(button.label, button.url);
  for (const match of cardBody(card, (value) => value).matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    add(match[1] ?? "", match[2] ?? "");
  }
  return rows;
}

function toSlackText(value: string): string {
  return value
    .replace(/\*\*([^*\n][^*]*?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    .replace(/  \n/g, "\n");
}

function toPlainText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*\n][^*]*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/  \n/g, "\n");
}

function toTelegramHtml(value: string): string {
  const html = escapeHtml(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/(?<!\\)\*\*([^*\n][^*]*?)(?<!\\)\*\*/g, "<b>$1</b>")
    .replace(/(?<!\\)\*([^*\n][^*]*?)(?<!\\)\*/g, "<i>$1</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\\([\\[\]*_~])/g, "$1")
    .replace(/  \n/g, "\n");
  return wrapTelegramBlockquotes(html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}

function wrapTelegramBlockquotes(value: string): string {
  const lines = value.split("\n");
  const out: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (quote.length === 0) return;
    out.push(`<blockquote>${quote.join("<br>")}</blockquote>`);
    quote = [];
  };

  for (const line of lines) {
    const match = /^&gt; ?(.*)$/.exec(line);
    if (match) {
      quote.push(match[1] ?? "");
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join("\n");
}
