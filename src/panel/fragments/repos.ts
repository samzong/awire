/**
 * Repos fragment - repo to channel routing + per-event subscription matrix.
 *
 * Events are grouped for readability. The "All events" toggle at the top of
 * each repo row expands a checkbox matrix; selecting "*" forwards everything.
 */

import type { ChannelConfig, RepoConfig } from "../../types.ts";
import { escapeHtml, emptyState, pageHeader, primaryButton, toast } from "./helpers.ts";

type EventOption = { key: string; label: string };

/** Logical event groupings shown in the matrix UI. */
const EVENT_GROUPS: { label: string; events: EventOption[] }[] = [
  {
    label: "Pull requests",
    events: [
      { key: "pull_request.opened", label: "Opened" },
      { key: "pull_request.closed", label: "Closed / merged" },
      { key: "pull_request.reopened", label: "Reopened" },
      { key: "pull_request.ready_for_review", label: "Ready for review" },
      { key: "pull_request.converted_to_draft", label: "Converted to draft" },
      { key: "pull_request.review_requested", label: "Review requested" },
      { key: "pull_request.review_request_removed", label: "Review request removed" },
      { key: "pull_request.assigned", label: "Assigned" },
      { key: "pull_request.unassigned", label: "Unassigned" },
      { key: "pull_request.labeled", label: "Labeled" },
      { key: "pull_request.unlabeled", label: "Unlabeled" },
    ],
  },
  {
    label: "Issues",
    events: [
      { key: "issues.opened", label: "Opened" },
      { key: "issues.closed", label: "Closed" },
      { key: "issues.reopened", label: "Reopened" },
      { key: "issues.assigned", label: "Assigned" },
      { key: "issues.unassigned", label: "Unassigned" },
      { key: "issues.labeled", label: "Labeled" },
      { key: "issues.unlabeled", label: "Unlabeled" },
      { key: "issues.edited", label: "Edited" },
      { key: "issues.deleted", label: "Deleted" },
      { key: "issues.transferred", label: "Transferred" },
    ],
  },
  {
    label: "Comments & reviews",
    events: [
      { key: "issue_comment.created", label: "Issue / PR comment created" },
      { key: "pull_request_review.submitted", label: "PR review submitted" },
      { key: "pull_request_review_comment.created", label: "PR review comment created" },
    ],
  },
  {
    label: "Code",
    events: [
      { key: "push", label: "Pushes" },
      { key: "release.published", label: "Release published" },
      { key: "release.prereleased", label: "Release prereleased" },
      { key: "release.edited", label: "Release edited" },
    ],
  },
  {
    label: "CI / Deploy",
    events: [
      { key: "workflow_run.completed", label: "Workflow completed" },
      { key: "check_run.completed", label: "Check completed" },
      { key: "check_run.rerequested", label: "Check re-requested" },
      { key: "deployment_status.created", label: "Deployment status created" },
    ],
  },
  {
    label: "Activity",
    events: [
      { key: "star.created", label: "Starred" },
      { key: "fork", label: "Forks" },
      { key: "watch.started", label: "Started watching" },
    ],
  },
];

/** Flatten the matrix into the events array stored in RepoConfig. */
export function allEventKeys(): string[] {
  return EVENT_GROUPS.flatMap((g) => g.events.map((e) => e.key));
}

const EVENT_KEY_SET = new Set(allEventKeys());

export function normalizeEventKeys(values: string[]): string[] {
  if (values.includes("*")) return ["*"];

  const out: string[] = [];
  for (const value of values) {
    const keys = EVENT_KEY_SET.has(value)
      ? [value]
      : allEventKeys().filter((key) => key.startsWith(`${value}.`));

    for (const key of keys) {
      if (!out.includes(key)) out.push(key);
    }
  }
  return out;
}

export function renderReposFragment(opts: {
  panelPath: string;
  repos: RepoConfig[];
  channels: ChannelConfig[];
}): string {
  const { panelPath, repos, channels } = opts;
  const newBtn = channels.length === 0
    ? ""
    : primaryButton("+ Add repo", {
        hxGet: `${panelPath}/fragments/repos/new`,
        hxTarget: "#modal-root",
      });

  if (channels.length === 0) {
    return pageHeader("Repos", "Sources to forward.", "") +
      emptyState("⚠️", "Add a channel first", "You need at least one Feishu channel before configuring repos.");
  }

  const channelMap = new Map(channels.map((c) => [c.id, c]));
  const rows = repos.length === 0
    ? emptyRepoRow()
    : repos.map((r) => repoRow(panelPath, r, channelMap)).join("");

  return pageHeader("Repos", "Sources to forward.", newBtn) + `
    <div class="bg-ink-900 border border-ink-800 rounded-xl overflow-x-auto">
      <table class="w-full min-w-[680px]">
        <thead>
          <tr class="border-b border-ink-800 text-left">
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium">Source</th>
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium">Channel</th>
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium">Events</th>
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium">Webhook</th>
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody id="repos-list">
          ${rows}
        </tbody>
      </table>
    </div>
    <div id="modal-root"></div>
  `;
}

function emptyRepoRow(): string {
  return `
    <tr class="border-b border-ink-850">
      <td colspan="5" class="px-5 py-6 text-sm text-ink-400 text-center">
        No explicit repo routes.
      </td>
    </tr>
  `;
}

function repoRow(
  panelPath: string,
  repo: RepoConfig,
  channelMap: Map<string, ChannelConfig>,
): string {
  const ch = channelMap.get(repo.channel_id);
  const allOn = repo.events.includes("*");
  const eventsSummary = allOn
    ? "All events"
    : repo.events.length === 0
      ? "No events"
      : `${repo.events.length} rule${repo.events.length === 1 ? "" : "s"}`;

  return `
    <tr class="border-b border-ink-850 hover:bg-ink-850/50 transition-colors">
      <td class="px-5 py-3.5">
        <a href="https://github.com/${escapeHtml(repo.full_name)}" target="_blank" rel="noreferrer"
           class="text-sm font-semibold text-ink-100 hover:text-accent-300">${escapeHtml(repo.full_name)}</a>
      </td>
      <td class="px-5 py-3.5 text-sm text-ink-200">${ch ? escapeHtml(ch.name) : `<span class="text-red-600">missing channel</span>`}</td>
      <td class="px-5 py-3.5 text-sm text-ink-200">${escapeHtml(eventsSummary)}</td>
      <td class="px-5 py-3.5">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] ${repo.webhook_secret ? "bg-green-50 text-green-700 border border-green-200" : "bg-ink-800 text-ink-400 border border-ink-700"}">${repo.webhook_secret ? "signed" : "unsigned"}</span>
      </td>
      <td class="px-5 py-3.5 text-right whitespace-nowrap">
        <button hx-get="${panelPath}/fragments/repos/${encodeURIComponent(repo.full_name)}/edit"
                hx-target="#modal-root"
                class="text-xs text-ink-400 hover:text-ink-200 px-2 py-1 rounded hover:bg-ink-800 transition-colors">Edit</button>
        <button hx-delete="${panelPath}/api/repos/${encodeURIComponent(repo.full_name)}"
                hx-target="#content"
                hx-swap="innerHTML"
                hx-confirm="Delete route for ${escapeHtml(repo.full_name)}? Incoming events for this repo will stop."
                class="text-xs text-red-600 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors">Delete</button>
      </td>
    </tr>
  `;
}

// ---------------------------------------------------------------------------
// Form (new + edit)
// ---------------------------------------------------------------------------

export interface RepoFormValues {
  full_name?: string;
  channel_id?: string;
  webhook_secret?: string;
  events?: string[];
}

export function renderRepoForm(opts: {
  panelPath: string;
  channels: ChannelConfig[];
  repo?: RepoConfig;
}): string {
  const { panelPath, channels, repo } = opts;
  const isEdit = Boolean(repo);
  const v: RepoFormValues = repo ?? {};
  const action = isEdit
    ? `${panelPath}/api/repos/${encodeURIComponent(repo!.full_name)}`
    : `${panelPath}/api/repos`;
  const methodLine = isEdit ? `<input type="hidden" name="_method" value="put" />` : "";

  const selected = new Set(v.events ?? []);

  const matrixHtml = EVENT_GROUPS.map((group) => `
    <div>
      <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">${escapeHtml(group.label)}</div>
      <div class="grid grid-cols-2 gap-1.5">
        ${group.events.map((e) => eventCheckbox(e.key, e.label, eventChecked(e.key, selected))).join("")}
      </div>
    </div>
  `).join("");

  const body = `
    <form hx-post="${escapeHtml(action)}"
          hx-target="#content"
          hx-swap="innerHTML"
          class="space-y-4">
      ${methodLine}
      <div>
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Repository <span class="text-ink-600 normal-case">(owner/name)</span></label>
        <input type="text" name="full_name" required ${isEdit ? "readonly" : ""} value="${escapeHtml(v.full_name ?? "")}"
               placeholder="octocat/Hello-World"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono ${isEdit ? "opacity-60" : ""}" />
      </div>
      <div>
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Forward to channel</label>
        <select name="channel_id" required
                class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent">
          ${channels.map((c) => `<option value="${escapeHtml(c.id)}" ${v.channel_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">GitHub webhook secret <span class="text-ink-600 normal-case">(optional)</span></label>
        <input type="text" name="webhook_secret" value="${escapeHtml(v.webhook_secret ?? "")}"
               placeholder="leave blank to accept unsigned deliveries"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" />
      </div>
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="block text-xs font-medium text-ink-400 uppercase tracking-wide">Events to forward</label>
          <label class="flex items-center gap-1.5 text-xs text-ink-300 cursor-pointer">
            <input type="checkbox" name="events" value="*" ${selected.has("*") ? "checked" : ""}
                   class="rounded border-ink-600 bg-ink-850 text-accent-500 focus:ring-accent-500"
                   onchange="this.closest('form').querySelectorAll('input[name=\\'events\\']').forEach((i) => { if (i.value !== '*') i.checked = this.checked; })" />
            All events
          </label>
        </div>
        <div class="space-y-3 rounded-lg bg-ink-850/50 border border-ink-800 p-3">
          ${matrixHtml}
        </div>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="awireCloseModal(this)"
                class="text-sm text-ink-400 hover:text-ink-200 px-3 py-2 rounded-lg hover:bg-ink-800 transition-colors">Cancel</button>
        <button type="submit"
                class="bg-accent-500 hover:bg-accent-400 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
          ${isEdit ? "Save changes" : "Add repo"}
        </button>
      </div>
    </form>
  `;

  return `
    <div class="fixed inset-0 z-40 flex items-center justify-center">
      <div onclick="awireCloseModal(this)" class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div class="relative bg-ink-900 border border-ink-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
        <div class="px-5 py-4 border-b border-ink-800 flex items-center justify-between sticky top-0 bg-ink-900">
          <h3 class="text-sm font-semibold text-ink-100">${isEdit ? "Edit repo" : "Add repo"}</h3>
          <button type="button" onclick="awireCloseModal(this)" class="text-ink-400 hover:text-ink-200 text-lg leading-none">×</button>
        </div>
        <div class="px-5 py-4">${body}</div>
      </div>
    </div>
  `;
}

function eventCheckbox(key: string, label: string, checked: boolean): string {
  return `
    <label class="flex items-center gap-2 text-xs text-ink-200 cursor-pointer px-2 py-1.5 rounded hover:bg-ink-800 transition-colors">
      <input type="checkbox" name="events" value="${escapeHtml(key)}" ${checked ? "checked" : ""}
             class="rounded border-ink-600 bg-ink-850 text-accent-500 focus:ring-accent-500" />
      ${escapeHtml(label)}
    </label>
  `;
}

function eventChecked(key: string, selected: Set<string>): boolean {
  return selected.has("*") || selected.has(key) || selected.has(key.split(".")[0]!);
}

/** Toast for successful mutations. */
export function renderRepoMutationToast(action: "added" | "updated" | "deleted", fullName: string): string {
  return toast(`Repo ${action}: ${fullName}`);
}
