/**
 * Channels fragment — Feishu bot targets CRUD.
 *
 * HTMX flow:
 *   - List view: GET /fragments/channels        → renderChannelsFragment
 *   - New form:  GET /fragments/channels/new    → renderChannelForm (in modal)
 *   - Edit form: GET /fragments/channels/:id/edit
 *   - Create:    POST /api/channels             → handler returns this list fragment
 *   - Update:    POST /api/channels/:id         (PUT via _method override)
 *   - Delete:    DELETE /api/channels/:id
 *   - Test send: POST /api/channels/:id/test    → returns a result fragment
 */

import type { ChannelConfig } from "../../types.ts";
import { escapeHtml, emptyState, pageHeader, primaryButton, toast } from "./helpers.ts";

export interface ChannelUsage {
  count: number;
  label: string;
  blockers: string[];
}

export function renderChannelsFragment(opts: {
  panelPath: string;
  channels: ChannelConfig[];
  usages?: Record<string, ChannelUsage>;
  notice?: string;
}): string {
  const { panelPath, channels, usages = {}, notice } = opts;
  const newBtn = primaryButton("+ Add channel", {
    hxGet: `${panelPath}/fragments/channels/new`,
    hxTarget: "#modal-root",
  });

  if (channels.length === 0) {
    return pageHeader("Channels", "Delivery targets.", newBtn) +
      emptyState("📢", "No channels yet", "Add your first Feishu bot webhook to start forwarding.", newBtn) +
      `<div id="modal-root"></div>`;
  }

  const rows = channels.map((ch) => channelRow(panelPath, ch, usages[ch.id])).join("");

  return pageHeader("Channels", "Delivery targets.", newBtn) + `
    ${notice ? `<div class="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">${escapeHtml(notice)}</div>` : ""}
    <div class="bg-ink-900 border border-ink-800 rounded-xl overflow-x-auto">
      <table class="w-full min-w-[620px]">
        <thead>
          <tr class="border-b border-ink-800 text-left">
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium">Name</th>
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium">Webhook</th>
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody id="channels-tbody" hx-target="closest tr" hx-swap="outerHTML">
          ${rows}
        </tbody>
      </table>
    </div>
    <div id="modal-root"></div>
  `;
}

function channelRow(panelPath: string, ch: ChannelConfig, usage?: ChannelUsage): string {
  const usageInfo = usage ?? { count: 0, label: "Not used", blockers: [] };
  const maskedUrl = maskWebhook(ch.webhook_url);
  const deleteControl = usageInfo.count > 0
    ? `<button type="button"
               disabled
               title="Remove ${escapeHtml(usageInfo.label)} before deleting this channel."
               class="text-xs text-ink-600 px-2 py-1 rounded cursor-not-allowed opacity-60">
          Delete
        </button>`
    : `<button hx-delete="${panelPath}/api/channels/${encodeURIComponent(ch.id)}"
                hx-target="#content"
                hx-swap="innerHTML"
                hx-confirm="Delete channel ${escapeHtml(ch.name)}? This cannot be undone."
                class="text-xs text-red-600 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors">
          Delete
        </button>`;
  return `
    <tr class="border-b border-ink-850 hover:bg-ink-850/50 transition-colors">
      <td class="px-5 py-3.5">
        <div class="text-sm font-medium text-ink-100">${escapeHtml(ch.name)}</div>
      </td>
      <td class="px-5 py-3.5">
        <code class="text-xs text-ink-200 font-mono">${escapeHtml(maskedUrl)}</code>
      </td>
      <td class="px-5 py-3.5 text-right whitespace-nowrap">
        <button hx-post="${panelPath}/api/channels/${encodeURIComponent(ch.id)}/test"
                hx-target="#modal-root"
                hx-swap="innerHTML"
                class="text-xs text-ink-400 hover:text-ink-200 px-2 py-1 rounded hover:bg-ink-800 transition-colors">
          Test
        </button>
        <button hx-get="${panelPath}/fragments/channels/${encodeURIComponent(ch.id)}/edit"
                hx-target="#modal-root"
                class="text-xs text-ink-400 hover:text-ink-200 px-2 py-1 rounded hover:bg-ink-800 transition-colors">
          Edit
        </button>
        ${deleteControl}
      </td>
    </tr>
  `;
}

function maskWebhook(url: string): string {
  const m = /\/hook\/(.+)$/.exec(url);
  if (!m) return url;
  const token = m[1]!;
  if (token.length <= 10) return url;
  const prefix = url.slice(0, url.length - token.length);
  return `${prefix}${token.slice(0, 4)}…${token.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Form (new + edit, in a modal)
// ---------------------------------------------------------------------------

export interface ChannelFormValues {
  name?: string;
  webhook_url?: string;
  sign_secret?: string;
}

export function renderChannelForm(opts: {
  panelPath: string;
  /** When set, this is an edit form. */
  channel?: ChannelConfig;
}): string {
  const { panelPath, channel } = opts;
  const isEdit = Boolean(channel);
  const v: ChannelFormValues = channel ?? {};
  const action = isEdit
    ? `${panelPath}/api/channels/${encodeURIComponent(channel!.id)}`
    : `${panelPath}/api/channels`;
  const methodLine = isEdit
    ? `<input type="hidden" name="_method" value="put" />`
    : "";

  const body = `
    <form ${methodLine ? '' : ''} hx-post="${escapeHtml(action)}"
          hx-target="#content"
          hx-swap="innerHTML"
          class="space-y-4">
      ${methodLine}
      <div>
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Name</label>
        <input type="text" name="name" required value="${escapeHtml(v.name ?? "")}"
               placeholder="Feishu · alerts"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent" />
      </div>
      <div>
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Webhook URL</label>
        <input type="url" name="webhook_url" required value="${escapeHtml(v.webhook_url ?? "")}"
               placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" />
      </div>
      <div>
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Signing secret <span class="text-ink-600 normal-case">(optional)</span></label>
        <input type="text" name="sign_secret" value="${escapeHtml(v.sign_secret ?? "")}"
               placeholder="leave blank if bot has no signature verification"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" />
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="awireCloseModal(this)"
                class="text-sm text-ink-400 hover:text-ink-200 px-3 py-2 rounded-lg hover:bg-ink-800 transition-colors">Cancel</button>
        <button type="submit"
                class="bg-accent-500 hover:bg-accent-400 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
          ${isEdit ? "Save changes" : "Add channel"}
        </button>
      </div>
    </form>
  `;

  return `
    <div class="fixed inset-0 z-40 flex items-center justify-center">
      <div onclick="awireCloseModal(this)" class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div class="relative bg-ink-900 border border-ink-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div class="px-5 py-4 border-b border-ink-800 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-ink-100">${isEdit ? "Edit channel" : "Add channel"}</h3>
          <button type="button" onclick="awireCloseModal(this)" class="text-ink-400 hover:text-ink-200 text-lg leading-none">×</button>
        </div>
        <div class="px-5 py-4">${body}</div>
      </div>
    </div>
  `;
}

/** Result card after a "Test send" — replaces modal-root. */
export function renderTestResult(opts: { ok: boolean; message: string; statusCode: number | null }): string {
  const color = opts.ok ? "green" : "red";
  const icon = opts.ok ? "✅" : "❌";
  const title = opts.ok ? "Test message sent" : "Test failed";
  return `
    <div class="fixed inset-0 z-40 flex items-center justify-center">
      <div onclick="awireCloseModal(this)" class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div class="relative bg-ink-900 border border-ink-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div class="px-5 py-4 border-b border-ink-800 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-ink-100">${title}</h3>
          <button type="button" onclick="awireCloseModal(this)" class="text-ink-400 hover:text-ink-200 text-lg leading-none">×</button>
        </div>
        <div class="px-5 py-4 space-y-3">
          <div class="flex items-center gap-2">
            <span class="text-xl">${icon}</span>
            <span class="text-sm text-ink-100">${escapeHtml(title)}</span>
          </div>
          ${opts.statusCode !== null ? `<div class="text-xs text-ink-400">Feishu StatusCode: <code class="text-${color}-400">${opts.statusCode}</code></div>` : ""}
          ${opts.message ? `<div class="text-xs text-ink-400 bg-ink-850 rounded-lg p-3 font-mono break-all">${escapeHtml(opts.message)}</div>` : ""}
          <div class="flex justify-end pt-2">
            <button type="button" onclick="awireCloseModal(this)" class="text-sm text-ink-200 px-3 py-2 rounded-lg bg-ink-800 hover:bg-ink-700 transition-colors">Close</button>
          </div>
        </div>
      </div>
    </div>
    ${toast(opts.ok ? "Test sent successfully" : "Test failed")}
  `;
}
