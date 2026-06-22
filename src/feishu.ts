/**
 * Feishu (Lark) custom-bot webhook client.
 *
 * Docs: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 *
 * Key facts (verified against Feishu docs):
 *   - POST to the webhook URL with Content-Type: application/json
 *   - msg_type: "interactive" carries a card in the "card" field
 *   - Optional signing: HMAC-SHA256 with key = `${timestamp}\n${secret}`,
 *     message = EMPTY STRING, then base64-encode the digest. The timestamp
 *     (seconds) and sign are added as top-level fields of the JSON body.
 *   - Success: HTTP 200 with body { StatusCode: 0, code: 0, msg: "success" }
 *   - Rate limits: 5/sec, 100/min per bot (enforced since 2022-01-05).
 *
 * The signing algorithm is the #1 footgun. Many implementations wrongly
 * HMAC the body — it MUST be the empty string.
 */

import type { FeishuCard } from "./types.ts";

export interface FeishuSendResult {
  ok: boolean;
  /** Feishu StatusCode field (0 = success). */
  statusCode: number | null;
  /** Feishu msg field (human-readable error). */
  message: string;
  /** HTTP status from the webhook endpoint. */
  httpStatus: number;
}

/**
 * Send a card to a Feishu custom bot. Returns a structured result so the
 * caller can decide how to respond to GitHub.
 */
export async function sendCard(
  webhookUrl: string,
  card: FeishuCard,
  signSecret: string | undefined,
): Promise<FeishuSendResult> {
  const body: Record<string, unknown> = {
    msg_type: "interactive",
    card,
  };

  if (signSecret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = await signFeishu(timestamp, signSecret);
    body.timestamp = timestamp;
    body.sign = sign;
  }

  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  // Feishu returns 200 even on logical errors (rate limit, bad card).
  // We must inspect the body's StatusCode field.
  let payload: { StatusCode?: number; code?: number; msg?: string } = {};
  try {
    payload = await resp.json();
  } catch {
    // Non-JSON response — fall through to HTTP-status reasoning.
  }

  const statusCode = payload.StatusCode ?? payload.code ?? null;
  const message = payload.msg ?? resp.statusText;

  return {
    ok: resp.ok && statusCode === 0,
    statusCode,
    message,
    httpStatus: resp.status,
  };
}

/**
 * Compute the Feishu custom-bot signature.
 *
 *   key     = `${timestamp}\n${secret}`  (UTF-8 bytes)
 *   message = ""                          (empty — NOT the body)
 *   sign    = base64( HMAC-SHA256(key, message) )
 *
 * `timestamp` is SECONDS since epoch (string of 10 digits).
 */
export async function signFeishu(
  timestamp: string,
  secret: string,
): Promise<string> {
  const keyBytes = new TextEncoder().encode(`${timestamp}\n${secret}`);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new Uint8Array(0), // empty message
  );
  return base64Encode(new Uint8Array(sig));
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]!);
  }
  return btoa(s);
}
