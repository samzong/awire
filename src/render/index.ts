/**
 * Event dispatcher: maps (event, action) to Feishu card.
 *
 * Specialized renderers live in sibling files. Anything without a specialized
 * renderer falls through to `generic.ts`, so we cover ALL GitHub events.
 *
 * Each renderer is a pure function: (payload) to FeishuCard. No I/O, no env -
 * that keeps them trivial to test and (in V2) trivial to batch.
 */

import type { FeishuCard, GitHubEventName, GitHubPayload } from "../types.ts";
import { escapeMd } from "./shared.ts";
import { renderGeneric } from "./generic.ts";
import { renderIssues } from "./issues.ts";
import { renderPullRequest } from "./pull_request.ts";
import { renderIssueComment, renderReviewComment } from "./comments.ts";
import { renderPullRequestReview } from "./reviews.ts";
import { renderPush } from "./push.ts";
import { renderRelease } from "./release.ts";
import { renderWorkflowRun, renderCheckRun, renderDeploymentStatus } from "./ci.ts";
import { renderStar, renderFork, renderWatch } from "./repo.ts";

export { renderCardText } from "./shared.ts";

/**
 * Render a GitHub event into a Feishu card, or null to drop silently.
 *
 * Returns null in two cases:
 *   1. The payload is malformed in a way that yields nothing to say.
 *   2. A specialized renderer explicitly decides "skip this action".
 */
export function renderEvent(
  event: GitHubEventName,
  action: string | undefined,
  payload: GitHubPayload,
): FeishuCard | null {
  switch (event) {
    case "ping":
      return renderPing(payload);
    case "issues":
      return renderIssues(action, payload);
    case "pull_request":
      return renderPullRequest(action, payload);
    case "issue_comment":
      return renderIssueComment(action, payload);
    case "pull_request_review_comment":
      return renderReviewComment(action, payload);
    case "pull_request_review":
      return renderPullRequestReview(action, payload);
    case "push":
      return renderPush(payload);
    case "release":
      return renderRelease(action, payload);
    case "workflow_run":
      return renderWorkflowRun(action, payload);
    case "check_run":
      return renderCheckRun(action, payload);
    case "deployment_status":
      return renderDeploymentStatus(payload);
    case "star":
      return renderStar(action, payload);
    case "fork":
      return renderFork(payload);
    case "watch":
      return renderWatch(payload);
    default:
      return renderGeneric(event, action, payload);
  }
}

/** Inline `ping` renderer - trivial enough to keep here. */
function renderPing(payload: GitHubPayload): FeishuCard {
  return {
    header: {
      title: { tag: "plain_text", content: `🏓 Webhook connected: ${payload.repository.full_name}` },
      template: "grey",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: [
            `**Repo:** [${payload.repository.full_name}](${payload.repository.html_url})`,
            payload.zen ? `> _${escapeMd(payload.zen)}_` : "",
            `Ready to forward events to awire.`,
          ].filter(Boolean).join("\n"),
        },
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "View Repository" },
            type: "primary",
            url: payload.repository.html_url,
          },
        ],
      },
    ],
  };
}

// Re-export shared helpers for specialized renderers.
export {
  escapeMd,
  truncate,
  userLink,
  repoLine,
  byLine,
  issueRefLine,
  actionButton,
  card,
  type CardBuilder,
} from "./shared.ts";
