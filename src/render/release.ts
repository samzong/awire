/**
 * `release` event renderer.
 *
 * Actions surfaced: published (primary) / prereleased / edited.
 * Unpublished / deleted / created are dropped — too noisy or already covered.
 *
 * release.name may be null; fall back to tag_name.
 */

import type { FeishuCard, FeishuHeaderColor, GitHubPayload } from "../types.ts";
import {
  byLine,
  card,
  escapeMd,
  repoLine,
  truncate,
} from "./shared.ts";

export function renderRelease(
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard | null {
  const release = p.release;
  if (!release) return null;

  const act = action ?? "published";
  if (act !== "published" && act !== "prereleased" && act !== "edited") {
    return null;
  }

  const isPre = release.prerelease || act === "prereleased";
  const color: FeishuHeaderColor = isPre ? "yellow" : "green";
  const emoji = isPre ? "🟡" : "🚀";

  const name = release.name || release.tag_name;
  const lines: string[] = [
    repoLine(p.repository),
    byLine(p.sender),
    `**Release:** \`${escapeMd(release.tag_name)}\`${isPre ? " _(prerelease)_" : ""}`,
  ];
  if (release.name && release.name !== release.tag_name) {
    lines.push(`**Name:** ${escapeMd(truncate(name, 120))}`);
  }

  if (release.body) {
    lines.push("");
    lines.push(`> ${escapeMd(truncate(release.body, 400))}`);
  }

  const verb = act === "edited" ? "edited" : isPre ? "prereleased" : "published";
  return card({
    title: `${emoji} Release ${verb}: ${truncate(name, 80)} (${p.repository.full_name})`,
    color,
    bodyLines: lines,
    button: { url: release.html_url, label: "View Release" },
  });
}
