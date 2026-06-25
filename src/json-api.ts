import { jsonApiApp } from "./json-api-app.ts";
import type { Env } from "./types.ts";

export async function handleJsonApi(req: Request, env: Env): Promise<Response> {
  return await jsonApiApp.fetch(req, env);
}
