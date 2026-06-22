/**
 * GitHub webhook signature verification.
 *
 * GitHub computes: HMAC-SHA256(key = webhook secret, message = raw body bytes)
 * and sends the hex digest in `X-Hub-Signature-256` prefixed with "sha256=".
 *
 * Verification uses crypto.subtle.verify (constant-time) to avoid timing
 * side-channels. The raw body MUST be verified before JSON.parse —
 * re-serialized JSON would have different byte ordering.
 *
 * Reference: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 *
 * Test vector (official):
 *   secret  = "It's a Secret to Everybody"
 *   payload = "Hello, World!"
 *   X-Hub-Signature-256 = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"
 */

/** Strategy enum kept out of the hot path for readability. */
export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify the GitHub webhook signature header against the raw body.
 *
 * Returns { ok: false } rather than throwing — callers decide how to log/respond.
 */
export async function verifyGitHubSignature(
  signatureHeader: string | null,
  rawBody: BufferSource,
  secret: string,
): Promise<VerifyResult> {
  if (!secret) {
    return { ok: false, reason: "webhook secret not configured" };
  }

  if (!signatureHeader) {
    return { ok: false, reason: "missing X-Hub-Signature-256 header" };
  }

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return { ok: false, reason: "signature header missing sha256= prefix" };
  }

  const receivedHex = signatureHeader.slice(prefix.length);
  const received = hexToBytes(receivedHex);
  if (received === null) {
    return { ok: false, reason: "signature is not valid hex" };
  }

  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  // crypto.subtle.verify is constant-time — preferred over manual compare.
  // Cast BufferSources — newer TS libs type Uint8Array generically in a way
  // that doesn't auto-satisfy ArrayBuffer, but the runtime accepts both.
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    received as BufferSource,
    rawBody as BufferSource,
  );
  return valid ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

/** Parse lowercase hex (GitHub's digest format) into a Uint8Array, or null on bad input. */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = hexCharValue(hex.charCodeAt(i * 2));
    const lo = hexCharValue(hex.charCodeAt(i * 2 + 1));
    if (hi < 0 || lo < 0) return null;
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function hexCharValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;       // 0-9
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;  // a-f
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;  // A-F
  return -1;
}

/**
 * Self-test against GitHub's documented test vector.
 * Called from a unit/smoke test; exported so the test can import it.
 */
export async function selfTest(): Promise<boolean> {
  const ok = await verifyGitHubSignature(
    "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    new TextEncoder().encode("Hello, World!"),
    "It's a Secret to Everybody",
  );
  return ok.ok;
}
