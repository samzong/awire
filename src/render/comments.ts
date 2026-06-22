/**
 * Comment renderers.
 *
 *   issue_comment                — conversation comments on issues AND PRs
 *   pull_request_review_comment  — inline diff line comments on a PR
 *
 * We only surface `created` prominently; edited/deleted are rare in chat and
 * tend to noise. They fall through to a quieter card.
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

export function renderIssueComment(
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard | null {
  const issue = p.issue;
  const comment = p.comment;
  if (!issue || !comment) return null;

  const act = action ?? "created";
  const isPR = Boolean(issue.pull_request);
  const kind = isPR ? "PR" : "Issue";

  // Only surface created. Edited/deleted are too noisy.
  if (act !== "created") return null;

  const lines: string[] = [
    repoLine(p.repository),
    byLine(p.sender),
    "",
    issueRefLine(issue, isPR ? "PR" : "issue"),
  ];

  if (comment.body) {
    lines.push("");
    lines.push(`> ${escapeMd(truncate(comment.body, 400))}`);
  }

  return card({
    title: `💬 Comment on ${kind} #${issue.number}`,
    color: "blue",
    bodyLines: lines,
    button: { url: comment.html_url, label: `View ${kind}` },
  });
}

export function renderReviewComment(
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard | null {
  const pr = p.pull_request;
  const comment = p.comment;
  if (!pr || !comment) return null;

  const act = action ?? "created";
  if (act !== "created") return null;

  const lines: string[] = [
    repoLine(p.repository),
    byLine(p.sender),
    "",
    issueRefLine(pr, "PR"),
  ];

  if (comment.path) {
    const loc = comment.line ? `:${comment.line}` : "";
    lines.push(`*File:* \`${escapeMd(comment.path)}${loc}\``);
  }
  if (comment.body) {
    lines.push("");
    lines.push(`> ${escapeMd(truncate(comment.body, 400))}`);
  }

  const color: FeishuHeaderColor = "blue";
  return card({
    title: `💬 Review comment on PR #${pr.number}`,
    color,
    bodyLines: lines,
    button: { url: comment.html_url, label: "View Comment" },
  });
}
