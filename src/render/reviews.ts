/**
 * `pull_request_review` event renderer.
 *
 * review.state values:
 *   approved            → 🟢 green  "Approved"
 *   changes_requested   → 🔴 red    "Changes Requested"
 *   commented           → 🔵 blue   "Commented"
 *   dismissed           → ⚪ grey   "Dismissed"
 *   pending             → drop (reviewer is composing — too noisy)
 *
 * Only surface `submitted`; edited/dismissed fall through quietly.
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

export function renderPullRequestReview(
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard | null {
  const pr = p.pull_request;
  const review = p.review;
  if (!pr || !review) return null;

  const act = action ?? "submitted";
  if (act !== "submitted") return null;
  if (review.state === "pending") return null;

  const { emoji, color, verb } = describeState(review.state);

  const lines: string[] = [
    repoLine(p.repository),
    byLine(p.sender),
    "",
    issueRefLine(pr, "PR"),
  ];

  if (review.body) {
    lines.push("");
    lines.push(`> ${escapeMd(truncate(review.body, 400))}`);
  }

  return card({
    title: `${emoji} ${verb} PR #${pr.number}`,
    color,
    bodyLines: lines,
    button: { url: review.html_url, label: "View Review" },
  });
}

function describeState(
  state: string,
): { emoji: string; color: FeishuHeaderColor; verb: string } {
  switch (state) {
    case "approved":
      return { emoji: "✅", color: "green", verb: "Approved" };
    case "changes_requested":
      return { emoji: "❌", color: "red", verb: "Changes Requested on" };
    case "dismissed":
      return { emoji: "⚪", color: "grey", verb: "Dismissed review on" };
    case "commented":
    default:
      return { emoji: "💬", color: "blue", verb: "Reviewed" };
  }
}
