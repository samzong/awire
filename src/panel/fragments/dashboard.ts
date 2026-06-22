/**
 * Dashboard fragment.
 *
 * Shows fleet counts, recent webhook volume, and a copy-pasteable summary of
 * the GitHub webhook endpoint.
 */

import type { ChannelConfig, RepoConfig } from "../../types.ts";

export function renderDashboardFragment(opts: {
  channels: ChannelConfig[];
  repos: RepoConfig[];
  recentEvents: number;
  webhookUrl: string;
}): string {
  const { channels, repos, recentEvents, webhookUrl } = opts;

  return `
    <div class="mb-6">
      <h1 class="text-2xl font-semibold text-ink-100">Dashboard</h1>
      <p class="text-sm text-ink-400 mt-1">Message routing control plane.</p>
    </div>

    <div class="grid grid-cols-3 gap-4 mb-8">
      ${statCard("Channels", String(channels.length), "📢", "Delivery targets")}
      ${statCard("Sources", String(repos.length), "📦", "Configured routes")}
      ${statCard("Events", String(recentEvents), "⚡", "Last 10 min")}
    </div>

    <div class="bg-ink-900 border border-ink-800 rounded-xl overflow-hidden">
      <div class="px-5 py-4 border-b border-ink-800">
        <h2 class="text-sm font-semibold text-ink-100">Webhook endpoint</h2>
        <p class="text-xs text-ink-400 mt-0.5">Use this endpoint for incoming webhook deliveries.</p>
      </div>
      <div class="px-5 py-4">
        <div class="flex items-center gap-2">
          <code class="flex-1 bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 font-mono break-all">${escapeHtml(webhookUrl)}</code>
          <button onclick='window.awireCopy(${JSON.stringify(webhookUrl)}, "URL copied")'
                  class="shrink-0 bg-ink-800 hover:bg-ink-700 text-ink-200 rounded-lg px-3 py-2 text-xs font-medium transition-colors">
            Copy
          </button>
        </div>
      </div>
    </div>
  `;
}

function statCard(label: string, value: string, icon: string, sub: string): string {
  return `
    <div class="bg-ink-900 border border-ink-800 rounded-xl px-5 py-4">
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs uppercase tracking-wide text-ink-400">${escapeHtml(label)}</div>
        <div class="text-base">${icon}</div>
      </div>
      <div class="text-2xl font-semibold text-ink-100">${escapeHtml(value)}</div>
      <div class="text-xs text-ink-400 mt-1">${escapeHtml(sub)}</div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}
