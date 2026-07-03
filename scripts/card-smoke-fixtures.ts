/// <reference types="node" />

import { renderEvent } from "../src/render/index.ts";
import type { FeishuCard, GitHubEventName, GitHubPayload, GitHubRepository, GitHubUser } from "../src/types.ts";

interface SmokeCase {
  label: string;
  event: GitHubEventName;
  action?: string;
  payload: GitHubPayload;
}

const repo: GitHubRepository = {
  full_name: "octocat/awire-smoke",
  name: "awire-smoke",
  html_url: "https://github.com/octocat/awire-smoke",
  description: "Smoke test repository for delivery card preview",
};

const sender = user("octocat");
const reviewer = user("hubot");
const issueUrl = `${repo.html_url}/issues/42`;
const pullUrl = `${repo.html_url}/pull/77`;
const commitSha = "0123456789abcdef0123456789abcdef01234567";

const issue = {
  number: 42,
  title: "Delivery cards should keep links readable",
  body: "Repo, user, issue, and action links should stay clickable.",
  html_url: issueUrl,
  state: "open" as const,
  user: sender,
};

const pullRequest = {
  number: 77,
  title: "Add multi-channel delivery cards",
  body: "This preview checks pull request card layout, quote rendering, and buttons.",
  html_url: pullUrl,
  state: "open" as const,
  draft: false,
  merged: false,
  user: sender,
  head: { ref: "feature/delivery-cards" },
  base: { ref: "main" },
  requested_reviewers: [reviewer],
};

export const smokeCases: SmokeCase[] = [
  {
    label: "ping",
    event: "ping",
    payload: {
      repository: repo,
      sender,
      hook_id: 123,
      zen: "Approachable is better than simple.",
    },
  },
  {
    label: "issues.opened",
    event: "issues",
    action: "opened",
    payload: { repository: repo, sender, issue },
  },
  {
    label: "pull_request.opened",
    event: "pull_request",
    action: "opened",
    payload: { repository: repo, sender, pull_request: pullRequest },
  },
  {
    label: "issue_comment.created",
    event: "issue_comment",
    action: "created",
    payload: {
      repository: repo,
      sender,
      issue,
      comment: {
        id: 1001,
        body: "Comment preview: the linked issue button should remain usable.",
        html_url: `${issueUrl}#issuecomment-1001`,
        user: sender,
      },
    },
  },
  {
    label: "pull_request_review_comment.created",
    event: "pull_request_review_comment",
    action: "created",
    payload: {
      repository: repo,
      sender: reviewer,
      pull_request: pullRequest,
      comment: {
        id: 1002,
        body: "Review comment preview: code path and line should show up.",
        html_url: `${pullUrl}#discussion_r1002`,
        user: reviewer,
        path: "src/delivery.ts",
        line: 88,
      },
    },
  },
  {
    label: "pull_request_review.submitted",
    event: "pull_request_review",
    action: "submitted",
    payload: {
      repository: repo,
      sender: reviewer,
      pull_request: pullRequest,
      review: {
        id: 2001,
        body: "Approved for delivery card smoke preview.",
        html_url: `${pullUrl}#pullrequestreview-2001`,
        state: "approved",
        user: reviewer,
      },
    },
  },
  {
    label: "push",
    event: "push",
    payload: {
      repository: repo,
      sender,
      ref: "refs/heads/main",
      before: "0000000000000000000000000000000000000000",
      after: commitSha,
      commits: [
        {
          id: commitSha,
          message: "Add delivery smoke command",
          url: `${repo.html_url}/commit/${commitSha}`,
          author: sender,
        },
      ],
      head_commit: {
        id: commitSha,
        message: "Add delivery smoke command",
        url: `${repo.html_url}/commit/${commitSha}`,
        author: sender,
      },
    },
  },
  {
    label: "release.published",
    event: "release",
    action: "published",
    payload: {
      repository: repo,
      sender,
      release: {
        id: 3001,
        name: "v1.2.3",
        tag_name: "v1.2.3",
        body: "Release card preview with a changelog excerpt.",
        html_url: `${repo.html_url}/releases/tag/v1.2.3`,
        prerelease: false,
        author: sender,
      },
    },
  },
  {
    label: "workflow_run.completed",
    event: "workflow_run",
    action: "completed",
    payload: {
      repository: repo,
      sender,
      workflow_run: {
        id: 4001,
        name: "CI",
        html_url: `${repo.html_url}/actions/runs/4001`,
        conclusion: "success",
        head_branch: "main",
        head_commit: { message: "Add delivery smoke command" },
      },
    },
  },
  {
    label: "check_run.completed",
    event: "check_run",
    action: "completed",
    payload: {
      repository: repo,
      sender,
      check_run: {
        id: 5001,
        name: "typecheck",
        html_url: `${repo.html_url}/runs/5001`,
        conclusion: "success",
        started_at: "2026-07-03T00:00:00Z",
        completed_at: "2026-07-03T00:01:00Z",
      },
    },
  },
  {
    label: "deployment_status.success",
    event: "deployment_status",
    payload: {
      repository: repo,
      sender,
      deployment: {
        id: 6001,
        environment: "production",
        html_url: `${repo.html_url}/deployments/6001`,
      },
      deployment_status: {
        id: 6002,
        state: "success",
        target_url: "https://example.com",
        description: "Production deployment is live.",
      },
    },
  },
  {
    label: "star.created",
    event: "star",
    action: "created",
    payload: { repository: repo, sender },
  },
  {
    label: "fork",
    event: "fork",
    payload: {
      repository: repo,
      sender,
      forkee: {
        full_name: "octocat/awire-smoke-fork",
        html_url: "https://github.com/octocat/awire-smoke-fork",
        owner: sender,
      },
    },
  },
  {
    label: "watch.started",
    event: "watch",
    action: "started",
    payload: { repository: repo, sender },
  },
  {
    label: "generic.repository_vulnerability_alert.create",
    event: "repository_vulnerability_alert",
    action: "create",
    payload: { repository: repo, sender },
  },
];

export function renderSmokeCard(sample: SmokeCase, prefix: string): FeishuCard {
  const card = renderEvent(sample.event, sample.action, sample.payload);
  if (!card) throw new Error(`renderer returned null for ${sample.label}`);
  card.header.title.content = `[${prefix}] ${card.header.title.content}`;
  return card;
}

export function envValue(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && !value.startsWith("replace-with-")) return value;
  }
  return "";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function user(login: string): GitHubUser {
  return {
    login,
    html_url: `https://github.com/${login}`,
  };
}
