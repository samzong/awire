/**
 * Panel HTML shell.
 *
 * Single-page layout rendered server-side: a top nav + a main content area.
 * HTMX swaps the content area on navigation; the shell stays put.
 *
 * Styling: built Tailwind CSS, inlined into the shell.
 * HTMX via CDN for partial swaps. Small inline helpers handle copy, toast, and
 * modal-close interactions.
 *
 * `PANEL_PATH` is interpolated into all fragment URLs so the whole panel
 * sits behind the non-guessable path.
 */

import { PANEL_CSS } from "./generated-css.ts";

export interface PanelShellOptions {
  panelPath: string;
  /** Initial fragment HTML to inject into #content. */
  initialContent: string;
  /** Which nav item is active: "dashboard" | "repos" | "channels". */
  activeNav: NavKey;
}

export type NavKey = "dashboard" | "repos" | "channels";

export function renderPanelShell(opts: PanelShellOptions): string {
  const { panelPath, initialContent, activeNav } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>awire · control panel</title>
  <script src="https://unpkg.com/htmx.org@2.0.4" defer></script>
  <style>${PANEL_CSS}</style>
</head>
<body class="min-h-screen text-ink-200 antialiased">
  <header class="border-b border-ink-800 bg-ink-900">
    <div class="max-w-5xl mx-auto px-8 py-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-accent-300 flex items-center justify-center font-bold text-white text-sm shrink-0">aw</div>
        <div class="text-ink-100 font-semibold leading-tight">awire</div>
      </div>
      <nav class="justify-self-center inline-flex items-center gap-1 rounded-lg border border-ink-800 bg-ink-850 p-1 shadow-card">
        ${navItem(panelPath, "dashboard", "📊", "Dashboard", activeNav)}
        ${navItem(panelPath, "repos", "📦", "Repos", activeNav)}
        ${navItem(panelPath, "channels", "📢", "Channels", activeNav)}
      </nav>
      <div class="justify-self-end flex items-center text-[11px] text-ink-400">
        <details class="relative">
          <summary class="list-none cursor-pointer text-xs font-medium text-ink-400 hover:text-red-600 px-2.5 py-1.5 rounded-md hover:bg-red-50 transition-colors [&::-webkit-details-marker]:hidden">
            Logout
          </summary>
          <div class="absolute right-0 mt-2 w-56 rounded-lg border border-ink-800 bg-ink-900 shadow-card z-50 p-3">
            <div class="text-sm font-medium text-ink-100">Sign out?</div>
            <div class="text-xs text-ink-400 mt-1">Your current panel session will end.</div>
            <div class="mt-3 flex justify-end gap-2">
              <button type="button"
                      onclick="this.closest('details').removeAttribute('open')"
                      class="text-xs font-medium text-ink-400 hover:text-ink-100 px-2 py-1.5 rounded-md hover:bg-white transition-colors">
                Cancel
              </button>
              <form action="${panelPath}/logout" method="post">
                <button type="submit"
                        class="text-xs font-semibold text-red-700 px-2.5 py-1.5 rounded-md bg-red-50 hover:bg-red-100 border border-red-200 transition-colors">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </details>
      </div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-8 py-8">
    <div id="content" class="fade-in">
      ${initialContent}
    </div>
  </main>

  <div id="toast-root"
       class="fixed bottom-6 right-6 z-50"
       style="display:none;">
    <div id="toast-message" class="bg-ink-700 border border-ink-600 text-ink-100 px-4 py-2.5 rounded-lg shadow-lg text-sm"></div>
  </div>

  <script>
    document.body.addEventListener('htmx:afterRequest', (e) => {
      if (e.detail.xhr && e.detail.xhr.status === 401) {
        fetch('${panelPath}/logout', { method: 'POST' }).finally(() => {
          window.location.href = '${panelPath}?err=1';
        });
        return;
      }
      if (e.detail.failed) awireToast('Request failed (' + e.detail.xhr.status + ')');
    });
    document.body.addEventListener('htmx:responseError', () => {
      awireToast('Server error — try again');
    });
    window.addEventListener('toast', (e) => awireToast(e.detail));
    let awireToastTimer = null;
    window.awireToast = (msg) => {
      const root = document.getElementById('toast-root');
      const message = document.getElementById('toast-message');
      if (!root || !message) return;
      message.textContent = msg;
      root.style.display = 'block';
      clearTimeout(awireToastTimer);
      awireToastTimer = setTimeout(() => { root.style.display = 'none'; }, 3000);
    };
    window.awireCloseModal = (el) => {
      const root = el.closest('#modal-root');
      if (root) root.innerHTML = '';
    };
    window.awireCopy = (text, msg) => {
      navigator.clipboard.writeText(text).then(() => {
        awireToast(msg || 'Copied');
      });
    };
  </script>
</body>
</html>`;
}

function navItem(
  panelPath: string,
  key: NavKey,
  icon: string,
  label: string,
  active: NavKey,
): string {
  const isActive = key === active;
  const cls = isActive
    ? "bg-white text-ink-100 shadow-card"
    : "text-ink-400 hover:bg-white hover:text-ink-100";
  return `<a href="${panelPath}/${key}"
       class="inline-flex items-center gap-2 whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${cls}">
       <span class="text-sm">${icon}</span>
       <span>${label}</span>
    </a>`;
}

/** Login page — standalone (not the panel shell). */
export function renderLoginPage(panelPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>awire · sign in</title>
  <style>${PANEL_CSS}</style>
</head>
<body class="min-h-screen flex items-center justify-center text-ink-200">
  <div class="w-full max-w-sm mx-auto px-6">
    <div class="text-center mb-8">
      <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-500 to-accent-300 flex items-center justify-center font-bold text-white text-lg mx-auto mb-3 shadow-lg">aw</div>
      <h1 class="text-2xl font-semibold text-ink-100">awire</h1>
      <p class="text-sm text-ink-400 mt-1">Sign in with your panel token</p>
    </div>
    <form id="login-form" action="${panelPath}/login" method="post" class="space-y-4">
      <div>
        <label class="block text-xs font-medium text-ink-400 mb-1.5 uppercase tracking-wide">Panel token</label>
        <input type="password" name="token" autocomplete="current-password" required
               class="w-full bg-white border border-ink-700 rounded-lg px-3.5 py-2.5 text-ink-100 placeholder-ink-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono text-sm"
               placeholder="••••••••••••••••" />
      </div>
      <button id="login-btn" type="submit"
              class="w-full bg-accent-500 hover:bg-accent-400 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg px-3.5 py-2.5 text-sm transition-colors shadow-sm">
        <span id="login-btn-text">Sign in</span>
      </button>
      <p id="err" class="text-xs text-red-500 text-center min-h-[1rem]"></p>
    </form>
  </div>
  <script>
    const form = document.getElementById('login-form');
    const btn = document.getElementById('login-btn');
    const btnText = document.getElementById('login-btn-text');
    const params = new URLSearchParams(window.location.search);
    const errEl = document.getElementById('err');
    if (params.get('err') === '1') errEl.textContent = 'Invalid token — check PANEL_TOKEN secret';
    form.addEventListener('submit', () => {
      const tokenInput = form.elements.namedItem('token');
      if (tokenInput) tokenInput.value = tokenInput.value.trim();
      btn.disabled = true;
      btnText.textContent = 'Signing in…';
    });
  </script>
</body>
</html>`;
}
