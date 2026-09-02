/**
 * Tool definitions, kept free of MCP transport concerns so they can be unit
 * tested by calling `handler` directly. `registerTools` in server.ts wires
 * them into the MCP server.
 */
import { z } from "zod";
import { MarkaestroApiError, type MarkaestroClient } from "./client";

export const CHANNELS = ["facebook", "instagram", "tiktok", "threads", "pinterest", "linkedin"] as const;
export const DELIVERY_MODES = ["direct_publish", "platform_inbox", "manual_reminder"] as const;

const channel = z.enum(CHANNELS);
const deliveryMode = z.enum(DELIVERY_MODES).describe(
  "direct_publish: official platform API. manual_reminder: a timed reminder for a person to post natively (default on facebook, instagram, tiktok). platform_inbox: TikTok inbox handoff. Required when scheduling facebook, instagram, or tiktok.",
);
const isoDate = z.string().describe("ISO 8601 UTC timestamp, for example 2026-09-10T14:00:00Z");

const target = z.object({
  channel,
  destinationId: z.string().optional().describe("Needed only when the brand has more than one destination for this channel; see list_destinations."),
  deliveryMode: deliveryMode.optional(),
  settings: z.record(z.string(), z.unknown()).optional().describe("Platform settings with __type equal to the channel (instagram: postType, collaborators, altText; tiktok: postMode, privacyLevel, ...)."),
});

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  readOnly: boolean;
  destructive?: boolean;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

/** Everything the API needs to know about channels, in one place an agent can read before posting. */
export const CHANNEL_RULES = `Markaestro channel rules (one post targets one or more channels; publishing never fans out across channels):
- facebook: text, images (max 10) or 1 video. Scheduling requires deliveryMode.
- instagram: at least 1 media item, max 10; a single video publishes as a Reel; stories take one image or video. Scheduling requires deliveryMode.
- tiktok: at least 1 media item: 1 video or up to 35 images. Default publish path is the creator's TikTok inbox; direct_post needs settings.privacyLevel. Scheduling requires deliveryMode.
- threads: text, image, or video; carousels up to 20 items.
- pinterest: media required; up to 5 images or exactly 1 video.
- linkedin: text required; images or 1 video, up to 20 items.
Caption limits: facebook 63206, linkedin 3000, instagram 2200, tiktok 2200, pinterest 500, threads 500.
Media: image/png, image/jpeg, image/webp, image/gif up to 10 MB; video/mp4, video/quicktime, video/webm up to 250 MB.
Posting model: create_post stores a draft unless scheduledAt is set (then the worker publishes at that time). publish_post queues an immediate publish and returns a job run to poll with get_job_run.
Every API key is bound to one brand (product). To act on another brand, use its own key.`;

export function createTools(client: MarkaestroClient): ToolDefinition[] {
  const get = <T>(path: string, query?: Record<string, string | number | undefined>) => client.request<T>("GET", path, undefined, query);

  return [
    {
      name: "list_products",
      title: "List brands",
      description: "List the brand (product) this API key is bound to, with its connected channels. Call this first to learn the productId and which channels can be posted to.",
      inputSchema: {},
      readOnly: true,
      handler: () => get("/api/public/v1/products"),
    },
    {
      name: "list_destinations",
      title: "List destinations",
      description: "List the publishable destinations (Facebook Page, Instagram account, TikTok account, ...) of a brand, with their ids and delivery modes. Use a destinationId on create_post only when a channel has more than one destination.",
      inputSchema: {
        productId: z.string().describe("Brand id from list_products"),
      },
      readOnly: true,
      handler: ({ productId }) => get(`/api/public/v1/products/${encodeURIComponent(String(productId))}/destinations`),
    },
    {
      name: "list_posts",
      title: "List posts",
      description: "List this brand's posts, newest first. Filter by status: draft, scheduled, publishing, published, platform_action_required, failed, partial_failed. Use cursor from a previous page to continue.",
      inputSchema: {
        status: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Default 25, max 100"),
        cursor: z.string().optional(),
      },
      readOnly: true,
      handler: ({ status, limit, cursor }) => get("/api/public/v1/posts", {
        status: status as string | undefined,
        limit: limit as number | undefined,
        cursor: cursor as string | undefined,
      }),
    },
    {
      name: "get_post",
      title: "Get a post",
      description: "Fetch one post with its targets, status, media, schedule, publish results, and live URL when published.",
      inputSchema: { postId: z.string() },
      readOnly: true,
      handler: ({ postId }) => get(`/api/public/v1/posts/${encodeURIComponent(String(postId))}`),
    },
    {
      name: "create_post",
      title: "Create a post",
      description: `Create a post for this brand. Without scheduledAt the post is saved as a DRAFT and nothing is published; with scheduledAt it is scheduled and the worker publishes it at that time. Pass either a single channel or a targets array (one entry per channel). Upload media first with upload_media and pass the asset ids. Read channel rules with get_channel_rules before posting.`,
      inputSchema: {
        caption: z.string().max(63206).default("").describe("Post text. Required on linkedin."),
        channel: channel.optional().describe("Single channel. Mutually exclusive with targets."),
        targets: z.array(target).min(1).max(6).optional().describe("Several channels at once, each with its own destination and delivery mode."),
        mediaAssetIds: z.array(z.string()).max(35).optional().describe("Asset ids from upload_media or list_media, in display order."),
        scheduledAt: isoDate.optional().describe("Omit to save a draft."),
        destinationId: z.string().optional().describe("For the single-channel form, when the brand has several destinations on that channel."),
        deliveryMode: deliveryMode.optional(),
        settings: z.record(z.string(), z.unknown()).optional().describe("Platform settings for the single-channel form; __type must equal channel."),
      },
      readOnly: false,
      handler: async (args) => {
        const body: Record<string, unknown> = {};
        for (const key of ["caption", "channel", "targets", "mediaAssetIds", "scheduledAt", "destinationId", "deliveryMode", "settings"]) {
          if (args[key] !== undefined) body[key] = args[key];
        }
        const result = await client.request<{ post: Record<string, unknown> }>("POST", "/api/public/v1/posts", body);
        const post = result.post;
        return {
          post,
          note: post.status === "scheduled"
            ? `Scheduled. It publishes at ${String(post.scheduledAt)} (UTC). Cancel with delete_post before then if needed.`
            : "Saved as a draft. Nothing is published until you call publish_post or a person publishes it from Markaestro.",
        };
      },
    },
    {
      name: "publish_post",
      title: "Publish a post now",
      description: "Queue an immediate publish of a draft post. Returns a job run; poll get_job_run until status is succeeded or failed. For manual_reminder targets this queues a reminder for a person instead of calling the platform. Confirm with the user before publishing anything public.",
      inputSchema: { postId: z.string() },
      readOnly: false,
      handler: ({ postId }) => client.request("POST", `/api/public/v1/posts/${encodeURIComponent(String(postId))}/publish`),
    },
    {
      name: "delete_post",
      title: "Delete a post",
      description: "Delete a draft or cancel a scheduled post. A published post is only removed from Markaestro; the live platform copy stays up. Posts mid-publish cannot be deleted until the run settles.",
      inputSchema: { postId: z.string() },
      readOnly: false,
      destructive: true,
      handler: ({ postId }) => client.request("DELETE", `/api/public/v1/posts/${encodeURIComponent(String(postId))}`),
    },
    {
      name: "bulk_posts",
      title: "Reschedule, delete, or restatus posts",
      description: "Apply one action to up to 25 posts: reschedule (needs scheduledAt), delete, or status (draft or scheduled). Per-post failures are reported individually.",
      inputSchema: {
        ids: z.array(z.string()).min(1).max(25),
        action: z.enum(["reschedule", "delete", "status"]),
        scheduledAt: isoDate.optional().describe("Required for reschedule"),
        status: z.enum(["draft", "scheduled"]).optional().describe("Required for the status action"),
      },
      readOnly: false,
      destructive: true,
      handler: ({ ids, action, scheduledAt, status }) => {
        const body: Record<string, unknown> = { ids, action };
        if (action === "reschedule") body.scheduledAt = scheduledAt;
        if (action === "status") body.status = status;
        return client.request("POST", "/api/public/v1/posts/bulk", body);
      },
    },
    {
      name: "create_posts",
      title: "Create several posts",
      description: "Create up to 25 posts in one call, for example a week of scheduled content. Each item takes the same fields as create_post. Failures are per item: the response lists ok/error for each, and the successful ones are created even when others fail.",
      inputSchema: {
        posts: z.array(z.object({
          caption: z.string().max(63206).default(""),
          channel: channel.optional(),
          targets: z.array(target).min(1).max(6).optional(),
          mediaAssetIds: z.array(z.string()).max(35).optional(),
          scheduledAt: isoDate.optional(),
          destinationId: z.string().optional(),
          deliveryMode: deliveryMode.optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
        })).min(1).max(25),
      },
      readOnly: false,
      handler: async ({ posts }) => {
        const items = (posts as Array<Record<string, unknown>>).map((item) => {
          const body: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(item)) if (value !== undefined) body[key] = value;
          return body;
        });
        return client.request("POST", "/api/public/v1/posts", { posts: items });
      },
    },
    {
      name: "upload_media",
      title: "Upload media",
      description: "Upload an image or video from a local file path, an http(s) URL, or a data: URL. Returns the media asset; pass its id in create_post mediaAssetIds. Counts against the workspace's monthly upload quota.",
      inputSchema: {
        source: z.string().describe("Local file path, http(s) URL, or data: URL"),
        fileName: z.string().optional(),
        contentType: z.string().optional().describe("Inferred from the file extension or URL when omitted"),
      },
      readOnly: false,
      handler: ({ source, fileName, contentType }) => client.uploadMedia({
        source: String(source),
        fileName: fileName as string | undefined,
        contentType: contentType as string | undefined,
      }).then((asset) => ({ asset })),
    },
    {
      name: "list_media",
      title: "List media",
      description: "List uploaded media assets with their ids, type, dimensions, and how many posts reference them.",
      inputSchema: {
        type: z.enum(["image", "video"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      readOnly: true,
      handler: ({ type, limit, cursor }) => get("/api/public/v1/media", {
        type: type as string | undefined,
        limit: limit as number | undefined,
        cursor: cursor as string | undefined,
      }),
    },
    {
      name: "get_media",
      title: "Get a media asset",
      description: "Fetch one media asset: type, dimensions, processing state, thumbnail, and how many posts reference it.",
      inputSchema: { assetId: z.string() },
      readOnly: true,
      handler: ({ assetId }) => get(`/api/public/v1/media/${encodeURIComponent(String(assetId))}`),
    },
    {
      name: "get_job_run",
      title: "Get a publish run",
      description: "Check the status of a publish run returned by publish_post: queued, running, succeeded, or failed, with the message and details.",
      inputSchema: { runId: z.string() },
      readOnly: true,
      handler: ({ runId }) => get(`/api/public/v1/job-runs/${encodeURIComponent(String(runId))}`),
    },
    {
      name: "list_job_runs",
      title: "List publish runs",
      description: "List recent publish runs, optionally filtered by status or by the post id (resourceId).",
      inputSchema: {
        status: z.enum(["queued", "running", "succeeded", "failed"]).optional(),
        resourceId: z.string().optional().describe("A post id"),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      readOnly: true,
      handler: ({ status, resourceId, limit, cursor }) => get("/api/public/v1/job-runs", {
        status: status as string | undefined,
        resourceId: resourceId as string | undefined,
        limit: limit as number | undefined,
        cursor: cursor as string | undefined,
      }),
    },
    {
      name: "list_webhook_endpoints",
      title: "List webhook endpoints",
      description: "List the webhook endpoints registered for this workspace (needs the webhooks.manage scope).",
      inputSchema: {},
      readOnly: true,
      handler: () => get("/api/public/v1/webhook-endpoints"),
    },
    {
      name: "create_webhook_endpoint",
      title: "Register a webhook endpoint",
      description: "Register an HTTPS endpoint for post.publish.queued, post.published, post.action_required, or post.failed events. The signing secret is returned once; store it.",
      inputSchema: {
        url: z.string().url(),
        events: z.array(z.enum(["post.publish.queued", "post.published", "post.action_required", "post.failed"])).min(1).max(4),
      },
      readOnly: false,
      handler: ({ url, events }) => client.request("POST", "/api/public/v1/webhook-endpoints", { url, events }),
    },
    {
      name: "get_channel_rules",
      title: "Channel rules",
      description: "The per-channel media, caption, and delivery-mode rules the API enforces, plus the draft-then-publish model. Read before creating posts.",
      inputSchema: {},
      readOnly: true,
      handler: async () => ({ rules: CHANNEL_RULES, keyMode: client.isTestKey ? "test" : "live", baseUrl: client.baseUrl }),
    },
  ];
}

/** Turn an API failure into text an agent can act on. */
export function describeError(error: unknown): string {
  if (error instanceof MarkaestroApiError) {
    const lines = [`${error.code} (HTTP ${error.status}): ${error.message}`];
    if (error.issues?.length) {
      for (const issue of error.issues) lines.push(`- ${issue.channel ? `${issue.channel}: ` : ""}${issue.code ? `${issue.code} ` : ""}${issue.message}`);
    }
    if (error.retryAfterSeconds) lines.push(`Retry after ${error.retryAfterSeconds} seconds.`);
    if (error.status === 401) lines.push("Check MARKAESTRO_API_KEY: the key is missing, revoked, expired, or in the wrong mode.");
    if (error.status === 403) lines.push("The key lacks the scope for this call. Create a key with the needed scopes under Settings > API Access.");
    if (error.status === 402) lines.push("The workspace hit a plan limit or has no active subscription.");
    if (error.requestId) lines.push(`requestId ${error.requestId}`);
    return lines.join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}
