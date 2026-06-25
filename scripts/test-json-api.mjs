#!/usr/bin/env node

const URL_ = process.env.URL ?? "http://localhost:8787";
const TOKEN = process.env.PANEL_TOKEN ?? process.env.TOKEN;

if (!TOKEN) {
  console.error("Set PANEL_TOKEN=<panel token>");
  process.exit(1);
}

const suffix = Date.now().toString(36);
let channelId = "";
let repoFullName = `octocat/awire-json-api-${suffix}`;

try {
  await request("GET", "/api/v1/whoami");

  const createdChannel = await request("POST", "/api/v1/channels", {
    name: `json-api-${suffix}`,
    webhook_url: "https://example.com/awire-test",
  });
  channelId = createdChannel.channel.id;

  await request("GET", `/api/v1/channels/${encodeURIComponent(channelId)}`);
  await request("PUT", `/api/v1/channels/${encodeURIComponent(channelId)}`, {
    name: `json-api-updated-${suffix}`,
  });

  const createdRepo = await request("POST", "/api/v1/repos", {
    full_name: repoFullName,
    channel_id: channelId,
    events: ["pull_request"],
  });
  repoFullName = createdRepo.repo.full_name;

  if (!createdRepo.repo.events.includes("pull_request.opened")) {
    throw new Error("coarse pull_request event was not normalized");
  }

  await request("GET", `/api/v1/repos/${encodeURIComponent(repoFullName)}`);
  await request("PUT", `/api/v1/repos/${encodeURIComponent(repoFullName)}`, {
    events: ["issues.opened"],
  });
} finally {
  if (repoFullName) await request("DELETE", `/api/v1/repos/${encodeURIComponent(repoFullName)}`, undefined, true);
  if (channelId) await request("DELETE", `/api/v1/channels/${encodeURIComponent(channelId)}`, undefined, true);
}

console.log("json api smoke ok");

async function request(method, path, body, allowFailure = false) {
  const resp = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  const payload = text ? JSON.parse(text) : {};
  if (!resp.ok && !allowFailure) {
    throw new Error(`${method} ${path} failed ${resp.status}: ${text}`);
  }
  return payload;
}
