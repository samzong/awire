/**
 * Panel authentication.
 *
 * Browser navigation uses the `awire_session` cookie. Bearer tokens remain
 * accepted for direct API checks and scripts.
 *
 * Single-user model: the token IS the PANEL_TOKEN secret. V1 has no
 * users/OAuth — V2 can swap this for signed session ids + GitHub OAuth.
 *
 * Token comparison MUST be constant-time to avoid timing side-channels.
 */

export const SESSION_COOKIE = "awire_session";

/** Verify a candidate token against the expected PANEL_TOKEN. Constant-time. */
export async function verifyPanelToken(
  candidate: string,
  expected: string,
): Promise<boolean> {
  if (!candidate || !expected) return false;
  if (candidate.length !== expected.length) return false;
  const a = new TextEncoder().encode(candidate);
  const b = new TextEncoder().encode(expected);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** Extract a bearer token from an Authorization header. */
export function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1]!.trim() : null;
}

/** Parse the awire_session cookie out of a Cookie header. */
export function extractSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * Extract the candidate token from a request — preferring Authorization
 * header (HTMX/AJAX) and falling back to the session cookie (navigation).
 */
export async function extractToken(req: Request, expected: string): Promise<boolean> {
  // Try Bearer header first.
  const bearer = extractBearer(req.headers.get("Authorization"));
  if (bearer && await verifyPanelToken(bearer, expected)) return true;
  // Fall back to cookie (page navigation).
  const cookie = extractSessionCookie(req.headers.get("Cookie"));
  if (cookie && await verifyPanelToken(cookie, expected)) return true;
  return false;
}

/** Build a Set-Cookie header value for the session cookie. */
export function buildSessionCookieHeader(token: string, panelPath: string): string {
  // Path = panelPath so the cookie is scoped to the panel only.
  // SameSite=Lax so cross-site navigations to the panel aren't blocked.
  // HttpOnly so JS can't read it.
  // Secure because workers.dev is always HTTPS.
  const path = panelPath.startsWith("/") ? panelPath : `/${panelPath}`;
  return `${SESSION_COOKIE}=${token}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}
