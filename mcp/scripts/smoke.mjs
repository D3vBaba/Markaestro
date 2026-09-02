#!/usr/bin/env node
/**
 * Live smoke test: starts the built server over stdio, drives it with the
 * MCP client, and walks the read paths plus a draft create/get/delete cycle.
 *
 *   MARKAESTRO_API_KEY=mk_test_... MARKAESTRO_BASE_URL=http://localhost:3000 npm run smoke
 *
 * Nothing is published. The draft it creates is deleted before exit.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.MARKAESTRO_API_KEY;
if (!apiKey) {
  console.error("Set MARKAESTRO_API_KEY (an mk_test_ key is safest).");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: { ...process.env, MARKAESTRO_API_KEY: apiKey },
  stderr: "pipe",
});
const client = new Client({ name: "markaestro-mcp-smoke", version: "0.1.0" });
await client.connect(transport);

const text = (result) => result.content.map((item) => item.text).join("\n");
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed:\n${text(result)}`);
  return JSON.parse(text(result));
};
const step = (label, value) => console.log(`✔ ${label}${value === undefined ? "" : `: ${value}`}`);

const { tools } = await client.listTools();
step("tools listed", tools.length);
const rules = await call("get_channel_rules");
step("channel rules", `${rules.keyMode} key against ${rules.baseUrl}`);
const products = await call("list_products");
const product = products.products?.[0];
if (!product) throw new Error("The key's brand did not come back from list_products");
step("brand", `${product.id} (${product.name})`);
const destinations = await call("list_destinations", { productId: product.id });
step("destinations", destinations.count ?? destinations.destinations?.length ?? 0);
const posts = await call("list_posts", { limit: 3 });
step("posts listed", posts.posts?.length ?? 0);
const media = await call("list_media", { limit: 3 });
step("media listed", media.assets?.length ?? 0);
const runs = await call("list_job_runs", { limit: 3 });
step("job runs listed", runs.runs?.length ?? 0);

const created = await call("create_post", { caption: `MCP smoke test ${new Date().toISOString()} (safe to delete)`, channel: "threads" });
step("draft created", `${created.post.id} status=${created.post.status}`);
if (created.post.status !== "draft") throw new Error("Expected a draft");
const fetched = await call("get_post", { postId: created.post.id });
step("draft fetched", fetched.post.caption.slice(0, 30));
const deleted = await call("delete_post", { postId: created.post.id });
step("draft deleted", deleted.deleted);

const bad = await client.callTool({ name: "get_post", arguments: { postId: "does-not-exist" } });
if (!bad.isError || !text(bad).includes("NOT_FOUND")) throw new Error("Expected a NOT_FOUND error result");
step("error surfaced as isError", text(bad).split("\n")[0]);

await client.close();
console.log("smoke passed");
