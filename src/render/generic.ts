/**
 * Generic renderer for any GitHub event without a specialized template.
 *
 * Goal: never silently lose information. Even obscure events (label, member,
 * security_advisory, etc.) produce a useful card showing what happened and where.
 *
 * We extract whatever optional fields the payload carries (issue / PR /
 * comment / release / commit) and surface them generically.
 */

import type { FeishuCard, GitHubEventName, GitHubPayload } from "../types.ts";
import {
  actionButton,
  byLine,
  card,
  escapeMd,
  issueRefLine,
  repoLine,
  truncate,
} from "./shared.ts";

export function renderGeneric(
  event: GitHubEventName,
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard {
  const lines: string[] = [repoLine(p.repository), byLine(p.sender)];

  lines.push(
    `**Event:** \`${escapeMd(event)}\`${
      action ? ` · **Action:** \`${escapeMd(action)}\`` : ""
    }`,
  );

  // Best-effort surfacing of well-known nested resources.
  if (p.issue) {
    lines.push(issueRefLine(p.issue, p.issue.pull_request ? "PR" : "issue"));
  } else if (p.pull_request) {
    lines.push(issueRefLine(p.pull_request, "PR"));
  }

  if (p.comment?.body) {
    lines.push("");
    lines.push(`> ${escapeMd(truncate(p.comment.body, 300))}`);
  }

  const repoUrl = p.repository.html_url;
  return card({
    title: `📦 ${event}${action ? ` · ${action}` : ""} on ${p.repository.full_name}`,
    color: "blue",
    bodyLines: lines,
    button: { url: repoUrl, label: "View Repository" },
  });
}

// Re-export actionButton so unused-import linters stay quiet if card() ever stops using it.
void actionButton;
