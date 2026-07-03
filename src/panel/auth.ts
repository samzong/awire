import type { Env } from "../types.ts";

export const SESSION_COOKIE = "awire_session";
const OAUTH_STATE_COOKIE = "awire_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface PanelSession {
  accountId: string;
  login: string;
  avatarUrl?: string;
  exp: number;
}

export interface GitHubOAuthUser {
  accountId: string;
  login: string;
  avatarUrl?: string;
}

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

export function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1]!.trim() : null;
}

export function extractSessionCookie(cookieHeader: string | null): string | null {
  return extractCookie(cookieHeader, SESSION_COOKIE);
}

export async function extractToken(req: Request, expected: string): Promise<boolean> {
  const bearer = extractBearer(req.headers.get("Authorization"));
  if (bearer && await verifyPanelToken(bearer, expected)) return true;
  const cookie = extractSessionCookie(req.headers.get("Cookie"));
  if (cookie && await verifyPanelToken(cookie, expected)) return true;
  return false;
}

export function buildSessionCookieHeader(value: string, panelPath: string): string {
  return `${SESSION_COOKIE}=${value}; Path=${cookiePath(panelPath)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookieHeader(panelPath: string): string {
  return `${SESSION_COOKIE}=; Path=${cookiePath(panelPath)}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function buildSignedSessionCookieHeader(
  user: GitHubOAuthUser,
  secret: string,
  panelPath: string,
): Promise<string> {
  const session: PanelSession = {
    accountId: user.accountId,
    login: user.login,
    avatarUrl: user.avatarUrl,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  return buildSessionCookieHeader(await signSession(session, secret), panelPath);
}

export async function readPanelSession(req: Request, secret: string): Promise<PanelSession | null> {
  const value = extractSessionCookie(req.headers.get("Cookie"));
  if (!value) return null;
  const session = await verifySession(value, secret);
  if (!session || session.exp < Date.now()) return null;
  return session;
}

export function buildGitHubAuthorizeUrl(env: Env, redirectUri: string, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return url.toString();
}

export function hasGitHubOAuthConfig(env: Env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET);
}

export function randomOAuthState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function buildOAuthStateCookieHeader(state: string, panelPath: string): string {
  return `${OAUTH_STATE_COOKIE}=${state}; Path=${cookiePath(panelPath)}; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function clearOAuthStateCookieHeader(panelPath: string): string {
  return `${OAUTH_STATE_COOKIE}=; Path=${cookiePath(panelPath)}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function verifyOAuthState(req: Request, state: string): boolean {
  const cookie = extractCookie(req.headers.get("Cookie"), OAUTH_STATE_COOKIE);
  return Boolean(cookie && state && cookie === state);
}

export async function exchangeGitHubCode(env: Env, code: string, redirectUri: string): Promise<GitHubOAuthUser> {
  const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "awire",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenPayload = await tokenResp.json().catch(() => null);
  const accessToken = isRecord(tokenPayload) && typeof tokenPayload.access_token === "string"
    ? tokenPayload.access_token
    : "";
  if (!tokenResp.ok || !accessToken) throw new Error("github token exchange failed");

  const userResp = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "awire",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const userPayload = await userResp.json().catch(() => null);
  if (!userResp.ok || !isRecord(userPayload)) throw new Error("github user fetch failed");

  const id = userPayload.id;
  const login = userPayload.login;
  const avatarUrl = userPayload.avatar_url;
  if (typeof id !== "number" || typeof login !== "string") throw new Error("github user payload invalid");

  return {
    accountId: `gh_${id}`,
    login,
    avatarUrl: typeof avatarUrl === "string" ? avatarUrl : undefined,
  };
}

async function signSession(session: PanelSession, secret: string): Promise<string> {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(session)));
  return `${payload}.${await hmac(payload, secret)}`;
}

async function verifySession(value: string, secret: string): Promise<PanelSession | null> {
  const [payload, sig, extra] = value.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  if (!(await safeEqual(sig, await hmac(payload, secret)))) return null;
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (typeof data.accountId !== "string" || typeof data.login !== "string" || typeof data.exp !== "number") return null;
  return {
    accountId: data.accountId,
    login: data.login,
    avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : undefined,
    exp: data.exp,
  };
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(sig));
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

function extractCookie(cookieHeader: string | null, target: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === target) return part.slice(eq + 1).trim();
  }
  return null;
}

function cookiePath(panelPath: string): string {
  return panelPath.startsWith("/") ? panelPath : `/${panelPath}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
