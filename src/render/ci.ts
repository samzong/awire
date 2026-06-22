/**
 * CI / deployment renderers.
 *
 *   workflow_run       — GitHub Actions workflow finished
 *   check_run          — generic check (CI, linters, external integrations)
 *   deployment_status  — environment deployment state change
 *
 * All three are about pipeline outcomes. We color by conclusion/state and
 * only surface `completed` (workflow_run) / `completed` (check_run) — the
 * in-progress transitions are too chatty for a chat notifier.
 */

import type { FeishuCard, FeishuHeaderColor, GitHubPayload } from "../types.ts";
import {
  byLine,
  card,
  escapeMd,
  repoLine,
  truncate,
} from "./shared.ts";

// ---------------------------------------------------------------------------

export function renderWorkflowRun(
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard | null {
  const run = p.workflow_run;
  if (!run) return null;

  const act = action ?? "completed";
  if (act !== "completed") return null;

  const conclusion = run.conclusion ?? "unknown";
  const { emoji, color, verb } = describeConclusion(conclusion);

  const lines: string[] = [
    repoLine(p.repository),
    byLine(p.sender),
    `**Workflow:** ${escapeMd(run.name)}`,
    `**Result:** ${verb}`,
    `**Branch:** \`${escapeMd(run.head_branch)}\``,
  ];
  if (run.head_commit?.message) {
    lines.push(`**Commit:** ${escapeMd(truncate(firstLine(run.head_commit.message), 80))}`);
  }

  return card({
    title: `${emoji} Workflow ${run.name}: ${verb} (${p.repository.full_name})`,
    color,
    bodyLines: lines,
    button: { url: run.html_url, label: "View Workflow Run" },
  });
}

// ---------------------------------------------------------------------------

export function renderCheckRun(
  action: string | undefined,
  p: GitHubPayload,
): FeishuCard | null {
  const check = p.check_run;
  if (!check) return null;

  const act = action ?? "completed";
  // Only surface completion (and explicit re-runs via rerequested).
  if (act !== "completed" && act !== "rerequested") return null;

  const conclusion = check.conclusion ?? "unknown";
  const { emoji, color, verb } = describeConclusion(conclusion);

  const lines: string[] = [
    repoLine(p.repository),
    byLine(p.sender),
    `**Check:** ${escapeMd(check.name)}`,
    `**Result:** ${verb}`,
  ];

  return card({
    title: `${emoji} Check ${check.name}: ${verb} (${p.repository.full_name})`,
    color,
    bodyLines: lines,
    button: { url: check.html_url, label: "View Check" },
  });
}

// ---------------------------------------------------------------------------

export function renderDeploymentStatus(p: GitHubPayload): FeishuCard | null {
  const status = p.deployment_status;
  const deployment = p.deployment;
  if (!status || !deployment) return null;

  const state = status.state ?? "unknown";
  const { emoji, color, verb } = describeDeploymentState(state);

  const lines: string[] = [
    repoLine(p.repository),
    byLine(p.sender),
    `**Environment:** ${escapeMd(deployment.environment)}`,
    `**Status:** ${verb}`,
  ];
  if (status.description) {
    lines.push(`> ${escapeMd(truncate(status.description, 200))}`);
  }

  return card({
    title: `${emoji} Deploy ${deployment.environment}: ${verb} (${p.repository.full_name})`,
    color,
    bodyLines: lines,
    button: {
      url: status.target_url ?? p.repository.html_url,
      label: status.target_url ? "View Deployment" : "View Repository",
    },
  });
}

// ---------------------------------------------------------------------------

function describeConclusion(
  conclusion: string,
): { emoji: string; color: FeishuHeaderColor; verb: string } {
  switch (conclusion) {
    case "success":
      return { emoji: "✅", color: "green", verb: "Success" };
    case "failure":
      return { emoji: "❌", color: "red", verb: "Failed" };
    case "cancelled":
      return { emoji: "⚪", color: "grey", verb: "Cancelled" };
    case "skipped":
      return { emoji: "⏭️", color: "grey", verb: "Skipped" };
    case "neutral":
      return { emoji: "⚪", color: "grey", verb: "Neutral" };
    case "action_required":
      return { emoji: "🟡", color: "yellow", verb: "Action Required" };
    case "timed_out":
      return { emoji: "⏱️", color: "red", verb: "Timed Out" };
    case "stale":
      return { emoji: "🟡", color: "yellow", verb: "Stale" };
    case "unknown":
    default:
      return { emoji: "❓", color: "blue", verb: "Unknown" };
  }
}

function describeDeploymentState(
  state: string,
): { emoji: string; color: FeishuHeaderColor; verb: string } {
  switch (state) {
    case "success":
      return { emoji: "✅", color: "green", verb: "Success" };
    case "failure":
    case "error":
      return { emoji: "❌", color: "red", verb: "Failed" };
    case "in_progress":
    case "queued":
    case "pending":
      return { emoji: "🟡", color: "yellow", verb: "In Progress" };
    case "inactive":
      return { emoji: "⚪", color: "grey", verb: "Inactive" };
    default:
      return { emoji: "📦", color: "blue", verb: state };
  }
}

function firstLine(msg: string): string {
  const i = msg.indexOf("\n");
  return i === -1 ? msg : msg.slice(0, i);
}
