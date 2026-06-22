/**
 * `pull_request` event renderer.
 *
 * Key action variants:
 *   opened            → 🟢 green
 *   closed + merged   → 🟢 green  ("Merged")
 *   closed + !merged  → 🔴 red    ("Closed without merge")
 *   reopened          → 🟢 green
 *   ready_for_review  → 🟡 yellow
 *   review_requested  → 🟣 violet
 *   converted_to_draft→ ⚪ grey
 *   labeled/unlabeled/assigned → 🔵 blue (info)
 *
 * Synchronized / edited / auto_merge_* are noisy and rarely useful in chat —
 * renderer returns null for those to drop them silently (event filter still
 * controls via allow-list; this is a renderer-level de-noise).
 */

import type { FeishuCard, FeishuHeaderColor, GitHubPayload } from "../types.ts";
import {
  byLine,
  card,
  escapeMd,
  issueRefLine,
  repoLine,
  truncate,
} from "./shared.ts";

export function renderPullRequest(
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard | null {
  const pr = p.pull_request;
  if (!pr) return null;
  const act = action ?? "updated";

  // Noisy actions — drop at the renderer level.
  const SILENT = new Set([
    "synchronized",
    "edited",
    "auto_merge_enabled",
    "auto_merge_disabled",
    "dequeued",
    "enqueued",
  ]);
  if (SILENT.has(act)) return null;

  const { emoji, color, verb } = describeAction(act, pr.merged);

  const lines: string[] = [repoLine(p.repository), byLine(p.sender)];

  if (act === "review_requested") {
    const reviewers = pr.requested_reviewers?.map((r) => `@${escapeMd(r.login)}`).join(", ");
    if (reviewers) lines.push(`**Review requested:** ${reviewers}`);
  } else if (act === "ready_for_review") {
    lines.push("**Marked ready for review** (was draft)");
  } else if (act === "converted_to_draft") {
    lines.push("**Converted to draft**");
  }

  lines.push("");
  lines.push(issueRefLine(pr, "PR"));

  if (pr.head && pr.base) {
    lines.push(`*Branch:* \`${escapeMd(pr.head.ref)}\` → \`${escapeMd(pr.base.ref)}\``);
  }
  if (pr.draft) lines.push("*Draft PR*");

  if ((act === "opened" || act === "ready_for_review") && pr.body) {
    lines.push("");
    lines.push(`> ${escapeMd(truncate(pr.body, 300))}`);
  }

  return card({
    title: `${emoji} PR ${verb}: #${pr.number} ${truncate(pr.title, 80)}`,
    color,
    bodyLines: lines,
    button: { url: pr.html_url, label: "View Pull Request" },
  });
}

function describeAction(
  act: string,
  merged: boolean,
): { emoji: string; color: FeishuHeaderColor; verb: string } {
  switch (act) {
    case "opened":
      return { emoji: "🟢", color: "green", verb: "Opened" };
    case "reopened":
      return { emoji: "🟢", color: "green", verb: "Reopened" };
    case "closed":
      return merged
        ? { emoji: "🟣", color: "purple", verb: "Merged" }
        : { emoji: "🔴", color: "red", verb: "Closed" };
    case "ready_for_review":
      return { emoji: "🟡", color: "yellow", verb: "Ready for Review" };
    case "review_requested":
      return { emoji: "🟣", color: "violet", verb: "Review Requested" };
    case "converted_to_draft":
      return { emoji: "⚪", color: "grey", verb: "To Draft" };
    case "labeled":
    case "unlabeled":
    case "assigned":
    case "unassigned":
    default:
      return { emoji: "🔵", color: "blue", verb: capitalize(act) };
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
