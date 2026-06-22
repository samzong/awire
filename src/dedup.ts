/**
 * GitHub delivery deduplication.
 *
 * GitHub retries a webhook delivery up to 8 times when the worker returns 5xx
 * or times out. Each retry carries the SAME `X-GitHub-Delivery` id. Without
 * dedup, an intermittent downstream failure (e.g. Feishu 5xx) would spam the
 * chat with duplicates once we recover.
 *
 * Strategy: record the delivery_id in DEDUP_KV with a 10-minute TTL. If we
 * see it again within the window, silently drop.
 *
 * Why KV, not a longer window: GitHub's retry schedule is ~minutes apart for
 * the first few attempts. 10 minutes covers the burst. KV reads are ~ms at
 * the edge — fast enough for the synchronous hot path.
 *
 * Why a separate namespace (DEDUP_KV, not CONFIG_KV):
 *   - Different lifetime (TTL 10min vs permanent)
 *   - Different blast radius (junk data vs user config)
 *   - Different write volume (per-webhook vs per-config-change)
 */

const DEDUP_TTL_SECONDS = 600;

export interface DedupResult {
  /** true = already seen, drop the request. false = first sighting, proceed. */
  duplicate: boolean;
}

/**
 * Mark a delivery as seen. Returns true if it was already seen (duplicate).
 *
 * Read-then-write is not atomic across concurrent retries, but GitHub's
 * retries are serial (next attempt only after the previous times out / 5xx),
 * so the race window is negligible. Worst case: a duplicate slips through —
 * acceptable for a chat-notifier.
 */
export async function checkAndMarkDelivery(
  dedupKv: KVNamespace,
  deliveryId: string | null,
): Promise<DedupResult> {
  if (!deliveryId) {
    // No delivery id header → can't dedup → don't drop.
    return { duplicate: false };
  }

  const existing = await dedupKv.get(deliveryId);
  if (existing !== null) {
    return { duplicate: true };
  }

  await dedupKv.put(deliveryId, "1", { expirationTtl: DEDUP_TTL_SECONDS });
  return { duplicate: false };
}

export async function countRecentDeliveries(dedupKv: KVNamespace): Promise<number> {
  let cursor: string | undefined;
  let count = 0;

  do {
    const page = await dedupKv.list({ cursor, limit: 1000 });
    count += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return count;
}
