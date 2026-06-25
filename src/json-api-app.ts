import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  deleteChannel,
  deleteRepo,
  getChannel,
  getRepo,
  listChannels,
  listRepos,
  putChannel,
  putRepo,
} from "./config.ts";
import { sendCard } from "./feishu.ts";
import { extractBearer, verifyPanelToken } from "./panel/auth.ts";
import { normalizeEventKeys } from "./panel/fragments/repos.ts";
import { renderCardText } from "./render/shared.ts";
import type { ChannelConfig, Env, RepoConfig } from "./types.ts";

type JsonApiEnv = { Bindings: Env };

const ErrorSchema = z.object({
  error: z.string().openapi({ example: "invalid request" }),
  repos: z.array(z.string()).optional(),
}).openapi("ErrorResponse");

const OkSchema = z.object({
  ok: z.boolean().openapi({ example: true }),
}).openapi("OkResponse");

const WhoamiSchema = z.object({
  ok: z.boolean().openapi({ example: true }),
  service: z.string().openapi({ example: "awire" }),
}).openapi("WhoamiResponse");

const ChannelSchema = z.object({
  id: z.string().openapi({ example: "2b2ed599-697c-4e83-93f4-92f18f5254e9" }),
  name: z.string().openapi({ example: "Feishu alerts" }),
  webhook_url: z.string().url().openapi({ example: "https://open.feishu.cn/open-apis/bot/v2/hook/..." }),
  sign_secret: z.string().optional(),
  created_at: z.string().datetime().openapi({ example: "2026-06-25T12:00:00.000Z" }),
  updated_at: z.string().datetime().openapi({ example: "2026-06-25T12:00:00.000Z" }),
}).openapi("Channel");

const RepoSchema = z.object({
  full_name: z.string().openapi({ example: "octocat/Hello-World" }),
  channel_id: z.string().openapi({ example: "2b2ed599-697c-4e83-93f4-92f18f5254e9" }),
  webhook_secret: z.string().optional(),
  events: z.array(z.string()).openapi({ example: ["pull_request.opened"] }),
  created_at: z.string().datetime().openapi({ example: "2026-06-25T12:00:00.000Z" }),
  updated_at: z.string().datetime().openapi({ example: "2026-06-25T12:00:00.000Z" }),
}).openapi("Repo");

const ChannelCreateSchema = z.object({
  name: z.string().trim().min(1).openapi({ example: "Feishu alerts" }),
  webhook_url: z.string().trim().url().refine(isHttpsUrl).openapi({
    example: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
  }),
  sign_secret: z.string().trim().min(1).optional(),
}).openapi("ChannelCreate");

const ChannelUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  webhook_url: z.string().trim().url().refine(isHttpsUrl).optional(),
  sign_secret: z.string().trim().min(1).nullable().optional(),
}).openapi("ChannelUpdate");

const RepoCreateSchema = z.object({
  full_name: z.string().trim().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/).openapi({ example: "octocat/Hello-World" }),
  channel_id: z.string().trim().min(1).openapi({ example: "2b2ed599-697c-4e83-93f4-92f18f5254e9" }),
  webhook_secret: z.string().trim().min(1).optional(),
  events: z.array(z.string().trim().min(1)).optional().openapi({ example: ["pull_request"] }),
}).openapi("RepoCreate");

const RepoUpdateSchema = z.object({
  channel_id: z.string().trim().min(1).optional(),
  webhook_secret: z.string().trim().min(1).nullable().optional(),
  events: z.array(z.string().trim().min(1)).optional().openapi({ example: ["issues.opened"] }),
}).openapi("RepoUpdate");

const ChannelParamsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "2b2ed599-697c-4e83-93f4-92f18f5254e9",
  }),
});

const RepoParamsSchema = z.object({
  full_name: z.string().openapi({
    param: { name: "full_name", in: "path" },
    description: "Repository full name. Slashes must be URL-encoded in raw HTTP paths.",
    example: "octocat/Hello-World",
  }),
});

const ChannelsResponseSchema = z.object({
  channels: z.array(ChannelSchema),
}).openapi("ChannelsResponse");

const ChannelResponseSchema = z.object({
  channel: ChannelSchema,
}).openapi("ChannelResponse");

const ReposResponseSchema = z.object({
  repos: z.array(RepoSchema),
}).openapi("ReposResponse");

const RepoResponseSchema = z.object({
  repo: RepoSchema,
}).openapi("RepoResponse");

const ChannelTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  statusCode: z.number().nullable(),
}).openapi("ChannelTestResponse");

export const jsonApiApp = new OpenAPIHono<JsonApiEnv>({
  defaultHook: (result, c) => {
    if (!result.success) return c.json({ error: "invalid request" }, 400);
  },
});

jsonApiApp.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "PANEL_TOKEN",
});

jsonApiApp.use("*", async (c, next) => {
  const bearer = extractBearer(c.req.header("Authorization") ?? null);
  if (!bearer || !(await verifyPanelToken(bearer, c.env.PANEL_TOKEN))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

jsonApiApp.notFound((c) => c.json({ error: "not found" }, 404));

export const openApiConfig = {
  openapi: "3.0.3",
  info: {
    title: "awire JSON Management API",
    version: "0.1.0",
    description: "JSON API for managing awire Feishu channels and repository routes.",
  },
  security: [{ bearerAuth: [] }],
} satisfies Parameters<typeof jsonApiApp.getOpenAPIDocument>[0];

const whoamiRoute = createRoute({
  method: "get",
  path: "/api/v1/whoami",
  tags: ["System"],
  operationId: "getWhoami",
  summary: "Check the current awire API token.",
  responses: {
    200: { description: "Authenticated token status.", content: { "application/json": { schema: WhoamiSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(whoamiRoute, (c) => c.json({ ok: true, service: "awire" }, 200));

const listChannelsRoute = createRoute({
  method: "get",
  path: "/api/v1/channels",
  tags: ["Channels"],
  operationId: "listChannels",
  summary: "List delivery channels.",
  responses: {
    200: { description: "Delivery channel list.", content: { "application/json": { schema: ChannelsResponseSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(listChannelsRoute, async (c) => c.json({ channels: await listChannels(c.env.CONFIG_KV) }, 200));

const createChannelRoute = createRoute({
  method: "post",
  path: "/api/v1/channels",
  tags: ["Channels"],
  operationId: "createChannel",
  summary: "Create a delivery channel.",
  request: {
    body: { required: true, content: { "application/json": { schema: ChannelCreateSchema } } },
  },
  responses: {
    201: { description: "Created delivery channel.", content: { "application/json": { schema: ChannelResponseSchema } } },
    400: { description: "Bad request.", content: { "application/json": { schema: ErrorSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(createChannelRoute, async (c) => {
  const body = c.req.valid("json");
  const now = timestamp();
  const channel: ChannelConfig = {
    id: crypto.randomUUID(),
    name: body.name,
    webhook_url: body.webhook_url,
    sign_secret: body.sign_secret,
    created_at: now,
    updated_at: now,
  };
  await putChannel(c.env.CONFIG_KV, channel);
  return c.json({ channel }, 201);
});

const getChannelRoute = createRoute({
  method: "get",
  path: "/api/v1/channels/{id}",
  tags: ["Channels"],
  operationId: "getChannel",
  summary: "Get one delivery channel.",
  request: { params: ChannelParamsSchema },
  responses: {
    200: { description: "Delivery channel.", content: { "application/json": { schema: ChannelResponseSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(getChannelRoute, async (c) => {
  const { id } = c.req.valid("param");
  const channel = await getChannel(c.env.CONFIG_KV, id);
  if (!channel) return c.json({ error: "channel not found" }, 404);
  return c.json({ channel }, 200);
});

const updateChannelRoute = createRoute({
  method: "put",
  path: "/api/v1/channels/{id}",
  tags: ["Channels"],
  operationId: "updateChannel",
  summary: "Update a delivery channel.",
  request: {
    params: ChannelParamsSchema,
    body: { required: true, content: { "application/json": { schema: ChannelUpdateSchema } } },
  },
  responses: {
    200: { description: "Updated delivery channel.", content: { "application/json": { schema: ChannelResponseSchema } } },
    400: { description: "Bad request.", content: { "application/json": { schema: ErrorSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(updateChannelRoute, async (c) => {
  const { id } = c.req.valid("param");
  const existing = await getChannel(c.env.CONFIG_KV, id);
  if (!existing) return c.json({ error: "channel not found" }, 404);

  const body = c.req.valid("json");
  const channel: ChannelConfig = {
    ...existing,
    name: body.name ?? existing.name,
    webhook_url: body.webhook_url ?? existing.webhook_url,
    sign_secret: nullableUpdate(body.sign_secret, existing.sign_secret),
    updated_at: timestamp(),
  };
  await putChannel(c.env.CONFIG_KV, channel);
  return c.json({ channel }, 200);
});

const deleteChannelRoute = createRoute({
  method: "delete",
  path: "/api/v1/channels/{id}",
  tags: ["Channels"],
  operationId: "deleteChannel",
  summary: "Delete an unused delivery channel.",
  request: { params: ChannelParamsSchema },
  responses: {
    200: { description: "Deleted.", content: { "application/json": { schema: OkSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found.", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Conflict.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(deleteChannelRoute, async (c) => {
  const { id } = c.req.valid("param");
  const channel = await getChannel(c.env.CONFIG_KV, id);
  if (!channel) return c.json({ error: "channel not found" }, 404);
  const repos = await listRepos(c.env.CONFIG_KV);
  const blockers = repos.filter((repo) => repo.channel_id === id).map((repo) => repo.full_name);
  if (blockers.length > 0) return c.json({ error: "channel is in use", repos: blockers }, 409);
  await deleteChannel(c.env.CONFIG_KV, id);
  return c.json({ ok: true }, 200);
});

const testChannelRoute = createRoute({
  method: "post",
  path: "/api/v1/channels/{id}/test",
  tags: ["Channels"],
  operationId: "testChannel",
  summary: "Send a test card through a delivery channel.",
  request: { params: ChannelParamsSchema },
  responses: {
    200: { description: "Feishu send result.", content: { "application/json": { schema: ChannelTestResponseSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(testChannelRoute, async (c) => {
  const { id } = c.req.valid("param");
  const channel = await getChannel(c.env.CONFIG_KV, id);
  if (!channel) return c.json({ error: "channel not found" }, 404);
  const result = await sendCard(
    channel.webhook_url,
    renderCardText(
      "awire test",
      `**Channel:** ${channel.name}\n**Time:** ${timestamp()}\n\nIf you see this, your Feishu webhook${channel.sign_secret ? " and signing secret" : ""} are configured correctly.`,
    ),
    channel.sign_secret,
  );
  return c.json({ ok: result.ok, message: result.message, statusCode: result.statusCode }, 200);
});

const listReposRoute = createRoute({
  method: "get",
  path: "/api/v1/repos",
  tags: ["Repos"],
  operationId: "listRepos",
  summary: "List repository routes.",
  responses: {
    200: { description: "Repository route list.", content: { "application/json": { schema: ReposResponseSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(listReposRoute, async (c) => c.json({ repos: await listRepos(c.env.CONFIG_KV) }, 200));

const createRepoRoute = createRoute({
  method: "post",
  path: "/api/v1/repos",
  tags: ["Repos"],
  operationId: "createRepo",
  summary: "Create a repository route.",
  request: {
    body: { required: true, content: { "application/json": { schema: RepoCreateSchema } } },
  },
  responses: {
    201: { description: "Created repository route.", content: { "application/json": { schema: RepoResponseSchema } } },
    400: { description: "Bad request.", content: { "application/json": { schema: ErrorSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(createRepoRoute, async (c) => {
  const body = c.req.valid("json");
  const fullName = body.full_name.toLowerCase();
  if (!(await getChannel(c.env.CONFIG_KV, body.channel_id))) {
    return c.json({ error: "channel not found" }, 400);
  }
  const now = timestamp();
  const repo: RepoConfig = {
    full_name: fullName,
    channel_id: body.channel_id,
    webhook_secret: body.webhook_secret,
    events: normalizeEventKeys(body.events ?? []),
    created_at: now,
    updated_at: now,
  };
  await putRepo(c.env.CONFIG_KV, repo);
  return c.json({ repo }, 201);
});

const getRepoRoute = createRoute({
  method: "get",
  path: "/api/v1/repos/{full_name}",
  tags: ["Repos"],
  operationId: "getRepo",
  summary: "Get one repository route.",
  request: { params: RepoParamsSchema },
  responses: {
    200: { description: "Repository route.", content: { "application/json": { schema: RepoResponseSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(getRepoRoute, async (c) => {
  const { full_name } = c.req.valid("param");
  const repo = await getRepo(c.env.CONFIG_KV, full_name);
  if (!repo) return c.json({ error: "repo not found" }, 404);
  return c.json({ repo }, 200);
});

const updateRepoRoute = createRoute({
  method: "put",
  path: "/api/v1/repos/{full_name}",
  tags: ["Repos"],
  operationId: "updateRepo",
  summary: "Update a repository route.",
  request: {
    params: RepoParamsSchema,
    body: { required: true, content: { "application/json": { schema: RepoUpdateSchema } } },
  },
  responses: {
    200: { description: "Updated repository route.", content: { "application/json": { schema: RepoResponseSchema } } },
    400: { description: "Bad request.", content: { "application/json": { schema: ErrorSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(updateRepoRoute, async (c) => {
  const { full_name } = c.req.valid("param");
  const existing = await getRepo(c.env.CONFIG_KV, full_name);
  if (!existing) return c.json({ error: "repo not found" }, 404);

  const body = c.req.valid("json");
  const channelId = body.channel_id ?? existing.channel_id;
  if (!(await getChannel(c.env.CONFIG_KV, channelId))) {
    return c.json({ error: "channel not found" }, 400);
  }

  const repo: RepoConfig = {
    ...existing,
    channel_id: channelId,
    webhook_secret: nullableUpdate(body.webhook_secret, existing.webhook_secret),
    events: body.events === undefined ? existing.events : normalizeEventKeys(body.events),
    updated_at: timestamp(),
  };
  await putRepo(c.env.CONFIG_KV, repo);
  return c.json({ repo }, 200);
});

const deleteRepoRoute = createRoute({
  method: "delete",
  path: "/api/v1/repos/{full_name}",
  tags: ["Repos"],
  operationId: "deleteRepo",
  summary: "Delete a repository route.",
  request: { params: RepoParamsSchema },
  responses: {
    200: { description: "Deleted.", content: { "application/json": { schema: OkSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found.", content: { "application/json": { schema: ErrorSchema } } },
  },
});

jsonApiApp.openapi(deleteRepoRoute, async (c) => {
  const { full_name } = c.req.valid("param");
  const repo = await getRepo(c.env.CONFIG_KV, full_name);
  if (!repo) return c.json({ error: "repo not found" }, 404);
  await deleteRepo(c.env.CONFIG_KV, full_name);
  return c.json({ ok: true }, 200);
});

function nullableUpdate(value: string | null | undefined, fallback: string | undefined): string | undefined {
  if (value === undefined) return fallback;
  if (value === null) return undefined;
  return value;
}

function isHttpsUrl(value: string): boolean {
  return /^https:\/\//i.test(value);
}

function timestamp(): string {
  return new Date().toISOString();
}
