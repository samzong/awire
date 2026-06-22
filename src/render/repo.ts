/**
 * Repo-activity renderers: star / fork / watch.
 *
 * These are social signals, intentionally lightweight cards. We only surface
 * the "additive" actions (starred, forked, started watching) — unstar /
 * unwatch are too chatty.
 */

import type { FeishuCard, GitHubPayload } from "../types.ts";
import {
  byLine,
  card,
  escapeMd,
  repoLine,
} from "./shared.ts";

export function renderStar(
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard | null {
  if (action !== "created") return null; // ignore unstar
  const repo = p.repository;
  return card({
    title: `⭐ ${p.sender.login} starred ${repo.full_name}`,
    color: "yellow",
    bodyLines: [
      repoLine(repo),
      byLine(p.sender),
      ...(repo.description ? [`> ${escapeMd(repo.description)}`] : []),
    ],
    button: { url: repo.html_url, label: "View Repository" },
  });
}

export function renderFork(p: GitHubPayload): FeishuCard | null {
  const forkee = p.forkee;
  if (!forkee) return null;
  const repo = p.repository;
  return card({
    title: `🍴 ${p.sender.login} forked ${repo.full_name}`,
    color: "blue",
    bodyLines: [
      repoLine(repo),
      byLine(p.sender),
      `**Fork:** [${escapeMd(forkee.full_name)}](${forkee.html_url})`,
    ],
    button: { url: forkee.html_url, label: "View Fork" },
  });
}

export function renderWatch(p: GitHubPayload): FeishuCard | null {
  const repo = p.repository;
  return card({
    title: `👀 ${p.sender.login} started watching ${repo.full_name}`,
    color: "blue",
    bodyLines: [repoLine(repo), byLine(p.sender)],
    button: { url: repo.html_url, label: "View Repository" },
  });
}
