/**
 * Shared helpers for all renderers.
 *
 * Kept tiny and stateless. Every function here is pure and synchronous.
 *
 * Why lark_md escaping matters: Feishu's lark_md parser treats `[`, `]`,
 * `(`, `)`, `*`, `_`, `` ` `` as formatting markers. Issue/PR titles and
 * bodies routinely contain these — unescaped, they break the card.
 */

import type {
  FeishuCard,
  FeishuElement,
  FeishuHeaderColor,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepository,
  GitHubUser,
} from "../types.ts";

// Re-export the card types so renderers can import everything from "./shared.ts".
export type { FeishuCard, FeishuElement, FeishuHeaderColor };

/**
 * Escape characters that lark_md treats as formatting, for use in inline
 * text that should render literally (titles, identifiers).
 *
 * Note: we deliberately do NOT escape backtick (it's used to mark code spans)
 * — code spans are useful for commit hashes / branch names.
 */
export function escapeMd(s: string): string {
  return s.replace(/([\\\[\]*_~])/g, "\\$1");
}

/** Truncate a string to `max` chars, appending an ellipsis if shortened. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Render a user as a lark_md link, e.g. [@octocat](https://github.com/octocat). */
export function userLink(u: GitHubUser | undefined): string {
  if (!u) return "unknown";
  const login = escapeMd(u.login);
  return u.html_url ? `[@${login}](${u.html_url})` : `@${login}`;
}

/** Standard "**Repo:** [owner/name](url)" line. */
export function repoLine(repo: GitHubRepository): string {
  return `**Repo:** [${escapeMd(repo.full_name)}](${repo.html_url})`;
}

/** Standard "**By:** [@user](url)" line. */
export function byLine(sender: GitHubUser): string {
  return `**By:** ${userLink(sender)}`;
}

/**
 * A reference to an issue or PR, as a lark_md blockquote with link.
 *   > [#42 Add login](https://github.com/.../pull/42)
 */
export function issueRefLine(
  ref: GitHubIssue | GitHubPullRequest,
  kind: "issue" | "PR",
): string {
  const tag = kind === "PR" ? "PR" : "Issue";
  const title = escapeMd(truncate(ref.title, 200));
  return `> [#${ref.number} ${title}](${ref.html_url})  \n*${tag} · ${escapeMd(ref.state)}*`;
}

/** A "View on GitHub" primary button. */
export function actionButton(url: string, label = "View on GitHub"): FeishuElement {
  return {
    tag: "action",
    actions: [
      {
        tag: "button",
        text: { tag: "plain_text", content: label },
        type: "primary",
        url,
      },
    ],
  };
}

export interface CardBuilder {
  title: string;
  color: FeishuHeaderColor;
  bodyLines: string[];
  button?: { url: string; label?: string };
}

/** Assemble a CardBuilder into a FeishuCard. */
export function card(b: CardBuilder): FeishuCard {
  const elements: FeishuElement[] = [];
  if (b.bodyLines.length > 0) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: b.bodyLines.join("\n") },
    });
  }
  if (b.button) {
    elements.push(actionButton(b.button.url, b.button.label));
  }
  return {
    header: {
      title: { tag: "plain_text", content: b.title },
      template: b.color,
    },
    elements,
  };
}

/** Pure-text card for the panel's "test send" feature. */
export function renderCardText(title: string, body: string): FeishuCard {
  return {
    header: {
      title: { tag: "plain_text", content: title },
      template: "green",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: body } },
    ],
  };
}
