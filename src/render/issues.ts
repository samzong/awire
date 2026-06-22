/**
 * `issues` event renderer.
 *
 * Actions surfaced: opened / closed / reopened / labeled / assigned / unlabeled / unassigned
 * Other actions (edited, transferred, …) fall through to a quiet info card.
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

export function renderIssues(
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard | null {
  const issue = p.issue;
  if (!issue) return null;

  const icon: Record<string, string> = {
    opened: "🟢",
    reopened: "🟢",
    closed: "🔴",
    labeled: "🏷️",
    unlabeled: "🏷️",
    assigned: "👤",
    unassigned: "👤",
  };
  const color: Record<string, FeishuHeaderColor> = {
    opened: "green",
    reopened: "green",
    closed: "red",
    labeled: "blue",
    unlabeled: "blue",
    assigned: "blue",
    unassigned: "blue",
  };

  const act = action ?? "updated";
  const emoji = icon[act] ?? "📝";
  const headerColor: FeishuHeaderColor = color[act] ?? "blue";

  const lines: string[] = [repoLine(p.repository), byLine(p.sender)];

  // Action-specific context.
  if (act === "closed") {
    const reason = issue.state_reason ? ` _(${escapeMd(issue.state_reason)})_` : "";
    lines.push(`**Closed**${reason}`);
  } else if (act === "labeled" || act === "unlabeled") {
    const labelName = readString(p, "label.name");
    if (labelName) lines.push(`**Label ${act}:** \`${escapeMd(labelName)}\``);
  } else if (act === "assigned" || act === "unassigned") {
    const assignee = readString(p, "assignee.login");
    if (assignee) lines.push(`**${act === "assigned" ? "Assigned to" : "Unassigned"}:** @${escapeMd(assignee)}`);
  } else {
    lines.push(`**Action:** ${escapeMd(act)}`);
  }

  lines.push("");
  lines.push(issueRefLine(issue, "issue"));

  if (act === "opened" && issue.body) {
    lines.push("");
    lines.push(`> ${escapeMd(truncate(issue.body, 300))}`);
  }

  return card({
    title: `${emoji} Issue ${capitalize(act)}: #${issue.number} ${truncate(issue.title, 80)}`,
    color: headerColor,
    bodyLines: lines,
    button: { url: issue.html_url, label: "View Issue" },
  });
}

function readString(p: GitHubPayload, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = p;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
