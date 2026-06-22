/**
 * `push` event renderer.
 *
 * GitHub fires `push` for branch/tag updates. Payload highlights:
 *   ref              "refs/heads/main"
 *   before/after     commit shas (0000… → branch created; …0000 → deleted)
 *   created/deleted  booleans
 *   forced           force-push
 *   commits[]        each has id, message, url
 *   head_commit      the tip
 *
 * We avoid spamming on huge pushes by capping displayed commits to 5 and
 * summarizing the rest. Branch deletions still get a card (informational).
 *
 * Tag pushes (ref starts with refs/tags/) are forwarded but rendered as
 * branch-style cards; the `release` event is the richer signal for releases.
 */

import type { FeishuCard, GitHubPayload } from "../types.ts";
import {
  byLine,
  card,
  escapeMd,
  repoLine,
  truncate,
} from "./shared.ts";

const MAX_COMMITS_SHOWN = 5;

export function renderPush(p: GitHubPayload): FeishuCard | null {
  const ref = p.ref ?? "refs/heads/unknown";
  const isTag = ref.startsWith("refs/tags/");
  const shortRef = ref.replace(/^refs\/(heads|tags)\//, "");
  const commits = p.commits ?? [];

  // Empty push (e.g. branch synced with no new commits) — skip.
  if (commits.length === 0 && !p.created && !p.deleted && !p.forced) {
    return null;
  }

  const lines: string[] = [repoLine(p.repository), byLine(p.sender)];

  if (p.deleted) {
    lines.push(`**Deleted** ${isTag ? "tag" : "branch"} \`${escapeMd(shortRef)}\``);
    return card({
      title: `🗑️ Deleted ${isTag ? "tag" : "branch"} ${shortRef} in ${p.repository.full_name}`,
      color: "red",
      bodyLines: lines,
      button: { url: p.repository.html_url, label: "View Repository" },
    });
  }

  if (p.forced) lines.push(`**Force-pushed** to \`${escapeMd(shortRef)}\``);
  if (p.created) lines.push(`**Created** ${isTag ? "tag" : "branch"} \`${escapeMd(shortRef)}\``);

  const shown = commits.slice(0, MAX_COMMITS_SHOWN);
  if (shown.length > 0) {
    lines.push("");
    lines.push(`**Commits:** ${commits.length}`);
    for (const c of shown) {
      const sha = c.id.slice(0, 7);
      const subject = escapeMd(truncate(firstLine(c.message), 80));
      lines.push(`- [\`${sha}\`](${c.url}) ${subject}`);
    }
    if (commits.length > shown.length) {
      const rest = commits.length - shown.length;
      lines.push(`_…and ${rest} more_`);
    }
  }

  const compareUrl = buildCompareUrl(p.repository.html_url, p.before, p.after);

  return card({
    title: `${isTag ? "🏷️" : "⬆️"} ${commits.length} commit${commits.length === 1 ? "" : "s"} → ${shortRef} in ${p.repository.full_name}`,
    color: "green",
    bodyLines: lines,
    button: { url: compareUrl, label: "View Changes" },
  });
}

function firstLine(msg: string): string {
  const i = msg.indexOf("\n");
  return i === -1 ? msg : msg.slice(0, i);
}

function buildCompareUrl(repoUrl: string, before?: string, after?: string): string {
  // 0000… means creation/deletion — no compare view exists.
  if (!before || !after) return repoUrl;
  if (before.match(/^0+$/) || after.match(/^0+$/)) return repoUrl;
  return `${repoUrl}/compare/${before.slice(0, 7)}...${after.slice(0, 7)}`;
}
