import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MarkaestroClient, DEFAULT_BASE_URL } from "./client.js";
import { CHANNEL_RULES, createTools, describeError } from "./tools.js";

export const SERVER_VERSION = "0.1.0";

export function clientFromEnv(env: Record<string, string | undefined> = process.env): MarkaestroClient {
  const apiKey = env.MARKAESTRO_API_KEY;
  if (!apiKey) {
    throw new Error("Set MARKAESTRO_API_KEY to a workspace API key (Settings > API Access in Markaestro).");
  }
  return new MarkaestroClient({ apiKey, baseUrl: env.MARKAESTRO_BASE_URL || DEFAULT_BASE_URL });
}

export function buildServer(client: MarkaestroClient): McpServer {
  const server = new McpServer({ name: "markaestro", version: SERVER_VERSION }, {
    instructions: [
      "Markaestro schedules and publishes social posts for one brand per API key.",
      "Start with list_products, then list_destinations when a channel needs a destinationId.",
      "create_post saves a draft unless scheduledAt is set. publish_post publishes now; ask the user before publishing anything public.",
      "Upload media with upload_media before referencing it. Read get_channel_rules for per-channel limits.",
    ].join(" "),
  });

  for (const tool of createTools(client)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.destructive ?? false,
          idempotentHint: tool.readOnly,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.handler(args ?? {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: describeError(error) }] };
        }
      },
    );
  }

  server.registerResource(
    "channel-rules",
    "markaestro://channel-rules",
    { title: "Channel rules", description: "Per-channel media, caption, and delivery-mode rules.", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: CHANNEL_RULES }] }),
  );

  server.registerPrompt(
    "schedule_post",
    {
      title: "Schedule a post",
      description: "Walk through creating and scheduling a post for this brand.",
      argsSchema: { brief: { type: "string" } as never },
    },
    ({ brief }: { brief?: string }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            "Schedule a Markaestro post from this brief:",
            brief || "(no brief given; ask me what to post)",
            "",
            "Steps: call get_channel_rules and list_products; pick channels the brand has connected; upload any media with upload_media; create the post with create_post using scheduledAt in UTC and an explicit deliveryMode for facebook, instagram, or tiktok; then show me the post id, status, and scheduled time. Do not call publish_post unless I ask.",
          ].join("\n"),
        },
      }],
    }),
  );

  return server;
}
