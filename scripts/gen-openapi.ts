/// <reference types="node" />

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { jsonApiApp, openApiConfig } from "../src/json-api-app.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "openapi/awire.yaml");
const shouldCheck = process.argv.includes("--check");

const document = jsonApiApp.getOpenAPIDocument(openApiConfig);
const text = stringify(document, { lineWidth: 0 });

if (shouldCheck) {
  const existing = await readFile(outPath, "utf8").catch(() => "");
  if (existing !== text) {
    console.error("openapi/awire.yaml is stale. Run pnpm gen:openapi.");
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text);
}
