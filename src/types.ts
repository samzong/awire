/**
 * awire — shared types.
 *
 * Three concerns:
 *   1. KV schema types (config + dedup)
 *   2. GitHub webhook payload types (only the fields we render)
 *   3. Feishu card types (the output shape)
 *
 * Reference: https://docs.github.com/en/webhooks/webhook-events-and-payloads
 */

// ===========================================================================
// 1. KV SCHEMA
// ===========================================================================

/**
 * CONFIG_KV layout:
 *   "channels:index"    -> ChannelConfig["id"][]
 *   "channel:<id>"      -> ChannelConfig
 *   "repos:index"       -> string[]   (lowercase "owner/name")
 *   "repo:<owner/name>" -> RepoConfig
 *
 * DEDUP_KV layout:
 *   "<delivery_id>"     -> "1"  (TTL 600s)
 */

export interface ChannelConfig {
  /** Stable id (nanoid). */
  id: string;
  /** Display name, e.g. "Feishu alerts". */
  name: string;
  /** Feishu custom-bot webhook URL. */
  webhook_url: string;
  /** Optional Feishu signing secret (enable signature verification on the bot). */
  sign_secret?: string;
  /** ISO timestamp. */
  created_at: string;
  /** ISO timestamp. */
  updated_at: string;
}

export interface RepoConfig {
  /** Lowercase "owner/name". */
  full_name: string;
  /** Target channel id (references ChannelConfig.id). */
  channel_id: string;
  webhook_secret?: string;
  /**
   * Event allow-list. Three granularities:
   *   "*"              -> all events of all actions
   *   "issues"         -> all actions of the issues event
   *   "issues.opened"  -> only the opened action
   * Empty array means nothing is forwarded.
   */
  events: string[];
  created_at: string;
  updated_at: string;
}

// ===========================================================================
// 2. GITHUB PAYLOAD (minimal - only fields we render)
// ===========================================================================

export interface GitHubUser {
  login: string;
  html_url: string;
  avatar_url?: string;
  type?: string;
}

export interface GitHubRepository {
  full_name: string;
  name: string;
  html_url: string;
  description?: string | null;
}

export interface GitHubLabel {
  name: string;
  color?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  state_reason?: string | null;
  user: GitHubUser;
  labels?: GitHubLabel[];
  /** Present iff this "issue" is actually a PR (issue_comment events). */
  pull_request?: unknown;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  user: GitHubUser;
  head: { ref: string };
  base: { ref: string };
  labels?: GitHubLabel[];
  requested_reviewers?: GitHubUser[];
}

export interface GitHubComment {
  id: number;
  body: string | null;
  html_url: string;
  user: GitHubUser;
  path?: string;       // review_comment only
  line?: number;       // review_comment only
}

export interface GitHubReview {
  id: number;
  body: string | null;
  html_url: string;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
  user: GitHubUser;
}

export interface GitHubCommit {
  id: string;
  message: string;
  url: string;
  author?: GitHubUser;
}

export interface GitHubRelease {
  id: number;
  name: string | null;
  tag_name: string;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  author: GitHubUser;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  html_url: string;
  conclusion: string | null;   // success | failure | cancelled | null (in progress)
  head_branch: string;
  head_commit?: { message: string };
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  html_url: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface GitHubDeploymentStatus {
  id: number;
  state: string;
  target_url: string | null;
  description: string | null;
}

export interface GitHubDeployment {
  id: number;
  environment: string;
  html_url?: string;
}

export interface GitHubForkee {
  full_name: string;
  html_url: string;
  owner: GitHubUser;
}

export interface GitHubPayload {
  action?: string;
  repository: GitHubRepository;
  sender: GitHubUser;
  // Optional envelopes (presence depends on event type)
  issue?: GitHubIssue;
  pull_request?: GitHubPullRequest;
  comment?: GitHubComment;
  review?: GitHubReview;
  number?: number;
  ref?: string;
  before?: string;
  after?: string;
  created?: boolean;
  deleted?: boolean;
  forced?: boolean;
  commits?: GitHubCommit[];
  head_commit?: GitHubCommit | null;
  ref_type?: string;
  master_branch?: string;
  release?: GitHubRelease;
  workflow_run?: GitHubWorkflowRun;
  check_run?: GitHubCheckRun;
  deployment?: GitHubDeployment;
  deployment_status?: GitHubDeploymentStatus;
  forkee?: GitHubForkee;
  // `ping` event
  hook_id?: number;
  zen?: string;
  // raw payload passthrough for generic renderer
  [key: string]: unknown;
}

export type GitHubEventName = string;

// ===========================================================================
// 3. FEISHU CARD OUTPUT
// ===========================================================================

/** Feishu interactive card. https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/quick-start */
export interface FeishuCard {
  config?: { wide_screen_mode?: boolean; update_multi?: boolean };
  header: {
    title: { tag: "plain_text"; content: string };
    template?: FeishuHeaderColor;
  };
  elements: FeishuElement[];
}

export type FeishuHeaderColor =
  | "blue" | "wathet" | "turquoise" | "green" | "yellow"
  | "orange" | "red" | "carmine" | "violet" | "purple"
  | "indigo" | "grey";

export type FeishuElement =
  | { tag: "div"; text: { tag: "lark_md"; content: string } }
  | { tag: "hr" }
  | { tag: "note"; elements: { tag: "plain_text" | "lark_md"; content: string }[] }
  | {
      tag: "action";
      actions: {
        tag: "button";
        text: { tag: "plain_text"; content: string };
        type?: "primary" | "default" | "danger" | "primary_filled" | "primary_outline";
        url: string;
      }[];
    };

/** Result of rendering an event. `null` means "do not send" (filtered). */
export interface RenderResult {
  card: FeishuCard;
}

// ===========================================================================
// 4. INTERNAL HANDLER TYPES
// ===========================================================================

/**
 * Environment bindings.
 *
 * KV namespaces come from `wrangler.jsonc` and are emitted into
 * worker-configuration.d.ts. Secrets (strings) aren't reflected in generated
 * types, so we declare them here. This interface MERGES with the generated
 * global `Env` (interface declaration merging) — both shapes apply.
 *
 * To stay robust even if `wrangler types` hasn't been run, we also redeclare
 * the KV bindings here; TS merges identical members without complaint.
 */
interface Env {
  CONFIG_KV: KVNamespace;
  DEDUP_KV: KVNamespace;
  PANEL_TOKEN: string;
  PANEL_PATH: string;
}

/** Re-exported so other modules can `import type { Env }`. */
export type { Env };

/** Result of webhook processing — controls the HTTP response. */
export type WebhookOutcome =
  | { kind: "ok" }
  | { kind: "ignored"; reason: string }
  | { kind: "error"; status: number; reason: string };

export const LOG_PREFIX = "awire";
