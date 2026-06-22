/**
 * Shared HTML helpers for panel fragments.
 *
 * Tiny and stateless. All user-supplied strings go through escapeHtml —
 * panel inputs flow back into rendered HTML, so XSS-safety is mandatory.
 */

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => {
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

export function pageHeader(title: string, subtitle: string, action = ""): string {
  return `
    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold text-ink-100">${escapeHtml(title)}</h1>
        <p class="text-sm text-ink-400 mt-1">${escapeHtml(subtitle)}</p>
      </div>
      <div>${action}</div>
    </div>
  `;
}

export function primaryButton(label: string, opts: { hxGet?: string; hxPost?: string; hxTarget?: string; type?: "button" | "submit" } = {}): string {
  const hx = opts.hxGet ? `hx-get="${escapeHtml(opts.hxGet)}"` :
             opts.hxPost ? `hx-post="${escapeHtml(opts.hxPost)}"` : "";
  const target = opts.hxTarget ? `hx-target="${escapeHtml(opts.hxTarget)}"` : "";
  const type = opts.type ?? "button";
  return `<button type="${type}" ${hx} ${target}
    class="inline-flex items-center gap-1.5 bg-accent-500 hover:bg-accent-400 text-white text-sm font-medium rounded-lg px-3.5 py-2 transition-colors">
    ${escapeHtml(label)}
  </button>`;
}

export function emptyState(icon: string, title: string, hint: string, cta = ""): string {
  return `
    <div class="bg-ink-900 border border-dashed border-ink-700 rounded-xl px-6 py-12 text-center">
      <div class="text-3xl mb-3">${icon}</div>
      <div class="text-ink-100 font-medium">${escapeHtml(title)}</div>
      <div class="text-sm text-ink-400 mt-1">${escapeHtml(hint)}</div>
      ${cta ? `<div class="mt-4">${cta}</div>` : ""}
    </div>
  `;
}

export function toast(msg: string): string {
  return `<script>window.dispatchEvent(new CustomEvent('toast', { detail: ${JSON.stringify(msg)} }));</script>`;
}
