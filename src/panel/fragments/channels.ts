/**
 * Channels fragment — delivery targets CRUD.
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
      emptyState("📢", "No channels yet", "Add your first delivery target to start forwarding.", newBtn) +
      `<div id="modal-root"></div>`;
  }

  const rows = channels.map((ch) => channelRow(panelPath, ch, usages[ch.id])).join("");

  return pageHeader("Channels", "Delivery targets.", newBtn) + `
    ${notice ? `<div class="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">${escapeHtml(notice)}</div>` : ""}
    <div class="bg-ink-900 border border-ink-800 rounded-xl overflow-hidden">
      <table class="w-full" style="table-layout: fixed;">
        <colgroup>
          <col style="width: 10rem" />
          <col style="width: 7rem" />
          <col />
          <col style="width: 11rem" />
        </colgroup>
        <thead>
          <tr class="border-b border-ink-800 text-left">
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium">Name</th>
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium">Type</th>
            <th class="px-5 py-3 text-[11px] uppercase tracking-wide text-ink-400 font-medium">Target</th>
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
  const deleteControl = (usage?.count ?? 0) > 0
    ? `<button type="button"
               disabled
               title="Remove ${escapeHtml(usage?.label ?? "Not used")} before deleting this channel."
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
        <span class="inline-flex items-center rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-[11px] uppercase text-ink-300">${escapeHtml(ch.kind)}</span>
      </td>
      <td class="px-5 py-3.5">
        <code class="block text-xs text-ink-200 font-mono" style="white-space: normal; overflow-wrap: anywhere;">${escapeHtml(channelTarget(ch))}</code>
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
  const m = /\/(hook|services)\/(.+)$/.exec(url);
  if (!m) return url;
  const token = m[2]!;
  if (token.length <= 10) return url;
  const prefix = url.slice(0, url.length - token.length);
  return `${prefix}${token.slice(0, 4)}…${token.slice(-4)}`;
}

function channelTarget(ch: ChannelConfig): string {
  if (ch.kind === "telegram") return `telegram:${ch.chat_id}`;
  return maskWebhook(ch.webhook_url);
}

// ---------------------------------------------------------------------------
// Form (new + edit, in a modal)
// ---------------------------------------------------------------------------

export interface ChannelFormValues {
  name?: string;
  kind?: string;
  webhook_url?: string;
  sign_secret?: string;
  bot_token?: string;
  chat_id?: string;
}

export function renderChannelForm(opts: {
  panelPath: string;
  channel?: ChannelConfig;
}): string {
  const { panelPath, channel } = opts;
  const isEdit = Boolean(channel);
  const v: ChannelFormValues = channel ?? {};
  const kind = v.kind ?? "feishu";
  const webhookValue = kind === "telegram" ? "" : (v.webhook_url ?? "");
  const signSecretValue = kind === "feishu" ? (v.sign_secret ?? "") : "";
  const chatIdValue = kind === "telegram" ? (v.chat_id ?? "") : "";
  const action = isEdit
    ? `${panelPath}/api/channels/${encodeURIComponent(channel!.id)}`
    : `${panelPath}/api/channels`;
  const methodLine = isEdit
    ? `<input type="hidden" name="_method" value="put" />`
    : "";
  const groupClass = (group: string) => group === kind ? "" : " hidden";
  const disabled = (group: string) => group === kind ? "" : " disabled";
  const required = (group: string, enabled = true) => group === kind && enabled ? " required" : "";

  const body = `
    <form ${methodLine ? '' : ''} hx-post="${escapeHtml(action)}"
          hx-target="#content"
          hx-swap="innerHTML"
          class="space-y-4">
      ${methodLine}
      <div>
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Name</label>
        <input type="text" name="name" required value="${escapeHtml(v.name ?? "")}" 
               placeholder="Alerts"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent" />
      </div>
      <div>
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Type</label>
        <select name="kind"
                onchange="awireChannelKindChanged(this)"
                class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent">
          ${["feishu", "slack", "telegram"].map((item) => `<option value="${item}" ${kind === item ? "selected" : ""}>${item}</option>`).join("")}
        </select>
      </div>
      <div data-channel-kind="feishu" class="${groupClass("feishu")}">
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Feishu webhook URL</label>
        <input type="url" name="webhook_url" data-required="true"${disabled("feishu")}${required("feishu")}
               value="${escapeHtml(webhookValue)}"
               placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" />
        <label class="block text-xs font-medium text-ink-400 mb-1.5 mt-4 uppercase tracking-wide">Feishu signing secret <span class="text-ink-600 normal-case">(optional)</span></label>
        <input type="text" name="sign_secret"${disabled("feishu")} value="${escapeHtml(signSecretValue)}"
               placeholder="optional Feishu signing secret"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" />
      </div>
      <div data-channel-kind="slack" class="${groupClass("slack")}">
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Slack webhook URL</label>
        <input type="url" name="webhook_url" data-required="true"${disabled("slack")}${required("slack")}
               value="${escapeHtml(webhookValue)}"
               placeholder="https://hooks.slack.com/services/..."
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" />
      </div>
      <div data-channel-kind="telegram" class="${groupClass("telegram")}">
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Telegram bot token</label>
        <input type="password" name="bot_token" autocomplete="off" data-required="${isEdit ? "false" : "true"}"${disabled("telegram")}${required("telegram", !isEdit)}
               placeholder="${isEdit ? "leave blank to keep existing token" : "123456789:ABC..."}"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" />
        <div class="mt-4 flex items-center justify-between gap-3">
          <label class="block text-xs font-medium text-ink-400 uppercase tracking-wide">Telegram chat ID</label>
          <button type="button"
                  hx-post="${escapeHtml(panelPath)}/api/telegram/chats"
                  hx-include="closest form"
                  hx-target="#telegram-chat-picker"
                  hx-swap="innerHTML"
                  class="text-xs text-accent-500 hover:text-accent-300 px-2 py-1 rounded hover:bg-ink-800 transition-colors">
            Discover chats
          </button>
        </div>
        <input type="text" name="chat_id" data-required="true"${disabled("telegram")}${required("telegram")} value="${escapeHtml(chatIdValue)}"
               placeholder="-1001234567890 or @channelname"
               class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3.5 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" />
        <div id="telegram-chat-picker" class="mt-2"></div>
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
    <script>
      window.awireChannelKindChanged = function(select) {
        const form = select.form;
        const kind = select.value;
        form.querySelectorAll('[data-channel-kind]').forEach(function(group) {
          const active = group.getAttribute('data-channel-kind') === kind;
          group.classList.toggle('hidden', !active);
          group.querySelectorAll('input').forEach(function(input) {
            input.disabled = !active;
            input.required = active && input.getAttribute('data-required') === 'true';
          });
        });
      };
    </script>
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
          ${opts.statusCode !== null ? `<div class="text-xs text-ink-400">Provider status code: <code class="text-${color}-400">${opts.statusCode}</code></div>` : ""}
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
