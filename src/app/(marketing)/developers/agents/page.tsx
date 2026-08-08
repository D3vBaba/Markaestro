/**
 * /developers/agents — the AI agent integration guide.
 *
 * Deliberately a server component (unlike the other marketing pages) so it can
 * export real metadata: this is the page an agent builder searches for, and it
 * is also the page an LLM crawls. The interactive bits (copy buttons) live in
 * the CopyBlock client component.
 */

import type { Metadata } from "next";
import Link from "next/link";
import MarketingLayout from "@/components/layout/MarketingLayout";
import CopyBlock from "@/components/marketing/CopyBlock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Markaestro for AI agents | Automate social publishing with an API key",
  description:
    "Give your AI agent a Markaestro API key and it can discover connected social accounts, upload media, draft, schedule, and publish posts across Facebook, Instagram, TikTok, LinkedIn, Threads, and Pinterest — with brand-scoped keys, idempotent writes, and human-in-the-loop publishing.",
  alternates: { canonical: "https://markaestro.com/developers/agents" },
  openGraph: {
    title: "Markaestro for AI agents",
    description:
      "One API key turns Markaestro into a publishing tool your agent can call: discover accounts, upload media, draft, schedule, publish, and report back.",
    url: "https://markaestro.com/developers/agents",
    type: "article",
  },
};

/* ─── Content ──────────────────────────────────────────────────────────── */

const whyCards = [
  {
    title: "One key, one brand",
    body: "Every API key is bound to a single brand when you create it. An agent holding that key can only ever see and post to that brand — cross-brand requests are rejected at authentication, not by convention.",
  },
  {
    title: "Discovery, not hardcoded ids",
    body: "The agent asks which accounts it can post to and gets back opaque ids to pass straight back. No Page ids, no Business Manager spelunking, no config file that rots when a connection is re-linked.",
  },
  {
    title: "Idempotent writes",
    body: "Send an Idempotency-Key on any create or publish. A retried call inside 24 hours replays the original response instead of creating a second post — the failure mode agents hit most.",
  },
  {
    title: "A human stays in the loop",
    body: "Facebook, Instagram, and TikTok posts are manual-first: your agent prepares them, a person posts them natively. Nothing goes out unattended unless you explicitly opt that post in.",
  },
];

const agentLoop = [
  {
    step: "01",
    title: "Discover",
    endpoint: "GET /api/connect/v1/social-accounts",
    body: "Returns every connected, publishable account for the key's brand, each with a platform, username, and an opaque id. Call it at the start of a run — connections change.",
  },
  {
    step: "02",
    title: "Upload media",
    endpoint: "POST /api/connect/v1/media/create-upload-url → PUT",
    body: "Mint a short-lived, single-use signed URL, then PUT the raw bytes to it. You get back a media id. Images up to 10 MB; the full API also takes video up to 250 MB.",
  },
  {
    step: "03",
    title: "Draft or schedule",
    endpoint: "POST /api/connect/v1/posts",
    body: "Pass the caption, the media ids, and the account ids verbatim. Leave it a draft for review, or send is_draft false with scheduled_at to put it on the calendar.",
  },
  {
    step: "04",
    title: "Publish",
    endpoint: "POST /api/public/v1/posts/:id/publish",
    body: "Queues an async run. LinkedIn, Threads, and Pinterest go out over the official API. Facebook, Instagram, and TikTok land in the workspace's To Post queue for a human to post natively.",
  },
  {
    step: "05",
    title: "Report back",
    endpoint: "GET /api/public/v1/job-runs/:id · webhooks",
    body: "Poll the run id, or register a webhook endpoint and let Markaestro push post.published, post.action_required, and post.failed to you. Never assume a publish finished synchronously.",
  },
];

const quickstartShell = `# The API is served from the marketing apex and the app subdomain alike.
export MARKAESTRO_URL="https://markaestro.com"
export MARKAESTRO_API_KEY="mk_live_<workspaceId>.<clientId>.<secret>"

# 1. What can this key post to?
curl -s "$MARKAESTRO_URL/api/connect/v1/social-accounts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"`;

const quickstartAccounts = `{
  "data": [
    {
      "id": "prod_123#instagram:instagram:ig_123",
      "product_id": "prod_123",
      "product": "Northwind Coffee",
      "platform": "instagram",
      "username": "northwindcoffee"
    }
  ]
}`;

const quickstartUpload = `# 2. Mint a signed upload url, then PUT the bytes.
RESP=$(curl -s -X POST "$MARKAESTRO_URL/api/connect/v1/media/create-upload-url" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "mime_type": "image/png", "size_bytes": 184320, "name": "cold-brew.png" }')
# → { "media_id": "ast_777", "upload_url": "https://.../media/upload?token=..." }

curl -X PUT "<upload_url>" \\
  -H "Content-Type: image/png" \\
  --data-binary @cold-brew.png`;

const quickstartPost = `# 3. Put it on the calendar. Pass the account id back verbatim.
curl -X POST "$MARKAESTRO_URL/api/connect/v1/posts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "caption": "Cold brew season starts Friday.",
    "media": ["ast_777"],
    "social_accounts": ["prod_123#instagram:instagram:ig_123"],
    "is_draft": false,
    "scheduled_at": "2026-08-14T15:00:00.000Z"
  }'

# 4. Check where everything stands.
curl -s "$MARKAESTRO_URL/api/connect/v1/posts?limit=20" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"`;

const toolDefinitions = `[
  {
    "name": "markaestro_list_accounts",
    "description": "List the social accounts this Markaestro key can publish to. Call this first in every run — never hardcode account ids. Returns id, platform, and username.",
    "input_schema": { "type": "object", "properties": {}, "required": [] }
  },
  {
    "name": "markaestro_upload_media",
    "description": "Upload one image or video to Markaestro and return a media asset id. Images: png, jpeg, webp, gif up to 10 MB. Video: mp4, mov, webm up to 250 MB.",
    "input_schema": {
      "type": "object",
      "properties": {
        "file_path": { "type": "string", "description": "Local path to the file to upload." },
        "mime_type": { "type": "string", "description": "MIME type of the file." }
      },
      "required": ["file_path", "mime_type"]
    }
  },
  {
    "name": "markaestro_create_post",
    "description": "Create a post for one channel. Facebook, Instagram, and TikTok are manual-first: a human posts them natively from the To Post queue. Omit delivery_mode unless the user explicitly asked for unattended publishing.",
    "input_schema": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string",
          "enum": ["facebook", "instagram", "tiktok", "linkedin", "threads", "pinterest"]
        },
        "caption": { "type": "string", "description": "Caption text, max 4000 characters." },
        "media_asset_ids": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Ids from markaestro_upload_media. Instagram and TikTok require at least one."
        },
        "destination_id": {
          "type": "string",
          "description": "From markaestro_list_accounts. Required only when the brand has more than one destination on that channel."
        },
        "delivery_mode": {
          "type": "string",
          "enum": ["manual_reminder", "direct_publish", "platform_inbox"],
          "description": "Omit for the channel default."
        }
      },
      "required": ["channel", "caption"]
    }
  },
  {
    "name": "markaestro_publish_post",
    "description": "Queue an async publish run for an existing post. Returns a run id — poll it, do not assume the post is live.",
    "input_schema": {
      "type": "object",
      "properties": { "post_id": { "type": "string" } },
      "required": ["post_id"]
    }
  },
  {
    "name": "markaestro_list_posts",
    "description": "List posts for this brand, newest first. Filter by status: draft, scheduled, publishing, published, platform_action_required, failed, partial_failed.",
    "input_schema": {
      "type": "object",
      "properties": {
        "status": { "type": "string" },
        "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
      },
      "required": []
    }
  },
  {
    "name": "markaestro_delete_post",
    "description": "Remove a post from Markaestro. Use it to cancel something scheduled. Deleting an already-published post does NOT retract the live copy on the platform.",
    "input_schema": {
      "type": "object",
      "properties": { "post_id": { "type": "string" } },
      "required": ["post_id"]
    }
  }
]`;

const agentBrief = `You have a Markaestro API key for exactly one brand. Markaestro is the
publishing layer: you supply the caption and the media, it handles the
platform rules, the calendar, and delivery.

Base URL: https://markaestro.com
Auth: Authorization: Bearer $MARKAESTRO_API_KEY

Rules:
- Call GET /api/connect/v1/social-accounts before posting. Pass the returned
  account ids back verbatim. Never invent or cache an id across runs.
- Upload media before creating a post; posts reference media ids, not files.
- Facebook, Instagram, and TikTok are manual-first. Creating and publishing
  them queues a reminder for a human — that is the intended behavior. Only
  send deliveryMode "direct_publish" if the operator explicitly asked for it.
- Send a unique Idempotency-Key on every POST. Reuse the SAME key when
  retrying the SAME request; never reuse it for a different one.
- On 429, wait the number of seconds in Retry-After, then retry. On 4xx other
  than 429, do not retry — report the error code and requestId and stop.
- Publishing is async. POST /publish returns a run id; poll
  GET /api/public/v1/job-runs/<id> until succeeded or failed.
- To cancel, list with ?status=scheduled and DELETE the post id. Deleting a
  published post does not remove it from the platform.
- Never claim a post is live until a run reports succeeded or a post reports
  published.`;

const guardrails = [
  {
    title: "Scope the key down",
    body: "Pick only the scopes the agent needs: products.read, media.write, posts.read, posts.write, posts.publish, job_runs.read, webhooks.manage. A research agent that only reads the calendar gets posts.read and nothing else.",
  },
  {
    title: "Give it an expiry",
    body: "Keys can be created with an expiry. An expired key behaves exactly like a revoked one, so a key that leaks out of an agent's environment stops working on its own.",
  },
  {
    title: "Rotate and revoke",
    body: "Rotate a key in place or revoke it outright from Settings → API. Every key shows its last-used time and request volume, so an agent that goes quiet — or goes rogue — is visible.",
  },
  {
    title: "Rate limits are enforced",
    body: "60 requests per minute per endpoint and 240 per minute per key. Every response carries X-RateLimit-Limit, -Remaining, and -Reset; a 429 carries Retry-After. Honor it rather than hammering.",
  },
  {
    title: "Markaestro never writes for you",
    body: "There is no generation step. The caption comes from your agent, the media comes from your library or your agent's pipeline. Markaestro is the hands, not the voice.",
  },
  {
    title: "Deletes are Markaestro-side",
    body: "Deleting a scheduled post cancels it before it ships. Deleting a published post only stops Markaestro tracking it — the live post stays up until someone removes it on the platform.",
  },
];

const errorRows = [
  { status: "401", code: "UNAUTHENTICATED", action: "Key is missing, revoked, or expired. Stop and ask a human for a new one — retrying will not help." },
  { status: "403", code: "FORBIDDEN", action: "The key lacks the scope for this call. Report which call failed; scopes are changed in Settings → API." },
  { status: "403", code: "API_KEY_NOT_BOUND_TO_PRODUCT", action: "A key issued before brand binding. Ask for a replacement key." },
  { status: "400", code: "VALIDATION_*", action: "The payload broke a channel rule (missing media, bad delivery mode, wrong scheduled_at). Fix the request; do not retry unchanged." },
  { status: "400", code: "VALIDATION_IDEMPOTENCY_KEY_REUSED", action: "The same Idempotency-Key was sent with a different body. Mint a new key per distinct request." },
  { status: "400", code: "VALIDATION_POST_IS_PUBLISHING", action: "Tried to delete a post while a publish run is in flight. Wait for the run to settle, then delete." },
  { status: "409", code: "VALIDATION_POST_ALREADY_PUBLISHING", action: "A publish run for this post is already queued. Do not publish again — poll the existing run instead." },
  { status: "402", code: "QUOTA_EXCEEDED_MEDIA_UPLOADS", action: "The workspace hit its monthly upload quota. Stop uploading and surface it — existing media still publishes." },
  { status: "404", code: "NOT_FOUND", action: "The id is outside this key's brand. Answered as 404 rather than 403 so keys cannot probe for ids they do not own." },
  { status: "429", code: "RATE_LIMITED", action: "Sleep for Retry-After seconds, then retry the same request with the same Idempotency-Key." },
];

const publishRecipe = `# Full control: draft → publish → poll. No productId needed —
# the key is already bound to one brand.

POST_ID=$(curl -s -X POST "$MARKAESTRO_URL/api/public/v1/posts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: post-2026-08-14-linkedin" \\
  -d '{
    "channel": "linkedin",
    "caption": "We shipped agent-driven publishing.",
    "mediaAssetIds": ["ast_777"]
  }' | jq -r .post.id)

RUN_ID=$(curl -s -X POST "$MARKAESTRO_URL/api/public/v1/posts/$POST_ID/publish" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Idempotency-Key: publish-$POST_ID" | jq -r .run.id)

# queued → running → succeeded | failed
curl -s "$MARKAESTRO_URL/api/public/v1/job-runs/$RUN_ID" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"`;

const auditRecipe = `# Review the queue, then cancel what the operator rejected.
curl -s "$MARKAESTRO_URL/api/public/v1/posts?status=scheduled&limit=100" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"

curl -X DELETE "$MARKAESTRO_URL/api/public/v1/posts/pst_123" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"
# → { "deleted": true, "id": "pst_123" }`;

const webhookRecipe = `# Let Markaestro call you instead of polling.
curl -X POST "$MARKAESTRO_URL/api/public/v1/webhook-endpoints" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-agent.example.com/hooks/markaestro",
    "events": ["post.published", "post.action_required", "post.failed"]
  }'

# Each delivery carries:
#   X-Markaestro-Event      post.action_required
#   X-Markaestro-Timestamp  2026-08-14T15:00:04.000Z
#   X-Markaestro-Signature  HMAC of the body with your webhook secret
# The secret is shown once at creation and stored hashed. Verify before acting.`;

const batchRecipe = `# One call, up to 25 posts. Per-item results — one bad item
# does not fail the batch.
curl -X POST "$MARKAESTRO_URL/api/public/v1/posts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: week-33-drop" \\
  -d '{
    "posts": [
      { "channel": "instagram", "caption": "Monday",  "mediaAssetIds": ["ast_1"] },
      { "channel": "facebook",  "caption": "Tuesday", "mediaAssetIds": ["ast_2"] },
      { "channel": "linkedin",  "caption": "Thursday" }
    ]
  }'
# → { "results": [...], "created": 3, "total": 3 }`;

const stacks = [
  { name: "Claude & the Claude Agent SDK", body: "Drop the tool definitions above into your tool list. The JSON Schema shapes are already in Claude tool-use format." },
  { name: "OpenAI function calling", body: "The same schemas map one-to-one onto function definitions — rename input_schema to parameters." },
  { name: "MCP servers", body: "If your agent speaks MCP, wrap these six calls in a small server. There is nothing Markaestro-specific to install on either side." },
  { name: "n8n, Make, Zapier", body: "Every endpoint is a plain HTTP request with a bearer token. No SDK, no signing ceremony, no OAuth dance for the agent." },
  { name: "LangChain & LlamaIndex", body: "Standard REST tools. The two-step media upload is the only multi-call flow, and it is two lines." },
  { name: "A cron job and curl", body: "Not every agent needs a framework. The quickstart above is a complete, working integration in four commands." },
];

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default function DevelopersAgentsPage() {
  return (
    <MarketingLayout>
      {/* ─── Hero ─── */}
      <section className="border-b bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <p className="mk-eyebrow">For AI agents</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.03em] leading-[1.08] lg:text-5xl">
            Hand your agent an API key. It runs your social channels.
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Markaestro is built to be operated by software. One workspace API key gives an agent everything it needs
            to discover which accounts it can post to, upload media, draft and schedule posts, publish them, and
            report back on what actually shipped — across Facebook, Instagram, TikTok, LinkedIn, Threads, and
            Pinterest.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            No SDK to install, no OAuth flow for the agent to survive, no platform-specific credentials to babysit.
            Your team connects the accounts once in the dashboard; the agent talks to one bearer-token API from then
            on.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/settings?tab=api">
              <Button className="rounded-lg h-9 text-[13px]">Create an API key</Button>
            </a>
            <Link href="/developers/api">
              <Button variant="outline" className="rounded-lg h-9 text-[13px]">
                Full API reference
              </Button>
            </Link>
            <a href="/llms.txt">
              <Button variant="ghost" className="rounded-lg h-9 text-[13px]">
                Machine-readable brief →
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ─── Why ─── */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="max-w-3xl">
            <p className="mk-eyebrow">Designed for autonomy, bounded on purpose</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
              Why an API key is the whole integration
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              The hard part of letting an agent touch social media is not the HTTP. It is making sure a confused
              model cannot post to the wrong brand, double-post on a retry, or ship something nobody read. Those
              guarantees are in the API surface itself, not in your prompt.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {whyCards.map((card) => (
              <Card key={card.title}>
                <CardHeader>
                  <CardTitle className="text-base">{card.title}</CardTitle>
                  <CardDescription className="leading-relaxed">{card.body}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ─── The loop ─── */}
      <section className="border-t" style={{ background: "var(--mk-paper)" }}>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">The agent loop</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            Five calls, start to finish
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Every Markaestro automation is a variation on this loop. Steps one through three are the{" "}
            <Link href="/developers/api#connect-api" className="underline underline-offset-2">
              Connect API
            </Link>{" "}
            — the flat surface most agents should target. Steps four and five reach into the full{" "}
            <code>/api/public/v1</code> API for explicit publishing and run tracking.
          </p>

          <div className="mt-10 grid gap-3">
            {agentLoop.map((item) => (
              <div key={item.step} className="rounded-xl border p-5 md:flex md:items-start md:gap-6">
                <div className="flex items-center gap-3 md:w-64 md:shrink-0">
                  <span
                    className="font-mono text-[11px] font-semibold"
                    style={{ color: "var(--mk-accent)", letterSpacing: "0.08em" }}
                  >
                    {item.step}
                  </span>
                  <span className="text-sm font-medium">{item.title}</span>
                </div>
                <div className="mt-3 md:mt-0">
                  <code className="text-[12px]" style={{ color: "var(--mk-accent)" }}>
                    {item.endpoint}
                  </code>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Quickstart ─── */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">Quickstart</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            A working integration in four commands
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            First, mint the key: open <a href="/settings?tab=api" className="underline underline-offset-2">Settings → API</a>,
            pick the brand it is allowed to touch, tick the scopes it needs, and optionally give it an expiry. The
            key is shown once — put it straight into your agent&apos;s secret store. Creating keys requires an admin
            or owner with a verified email.
          </p>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">1. Discover the accounts</CardTitle>
                  <CardDescription>
                    The first call in every run. Connections change; ids should never be baked into a prompt.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CopyBlock code={quickstartShell} label="bash" />
                  <CopyBlock code={quickstartAccounts} label="response" />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">2. Upload the media</CardTitle>
                  <CardDescription>
                    Two steps: mint a signed, single-use URL, then PUT the bytes. The URL expires after 15 minutes
                    and needs no auth header of its own.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CopyBlock code={quickstartUpload} label="bash" />
                </CardContent>
              </Card>
            </div>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">3. Schedule it, then watch it</CardTitle>
                <CardDescription>
                  Creating is draft-first by default. Send <code>is_draft: false</code> with a{" "}
                  <code>scheduled_at</code> timestamp to put the post on the calendar instead.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={quickstartPost} label="bash" />
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── Tool definitions ─── */}
      <section className="border-t" style={{ background: "var(--mk-paper)" }}>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">Drop-in</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            Tool definitions and an agent brief
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Two things to copy. The first is a set of tool schemas covering the whole publishing loop — written in
            JSON Schema, so they work as Claude tool definitions, OpenAI functions, or the input shape for an MCP
            server you host. The second is the operating brief that keeps a model from doing something surprising
            with them.
          </p>

          <div className="mt-10 grid gap-6 lg:grid-cols-2 lg:items-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tool schemas</CardTitle>
                <CardDescription>
                  Six tools: list accounts, upload media, create, publish, list, delete. Wire each one to the
                  matching endpoint above.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[560px] overflow-y-auto">
                  <CopyBlock code={toolDefinitions} label="tools.json" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Agent brief</CardTitle>
                <CardDescription>
                  Paste into your system prompt. It encodes the behaviors that separate a reliable publishing agent
                  from one that double-posts and declares victory early.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CopyBlock code={agentBrief} label="system prompt" />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Your agent can also fetch this itself:{" "}
                  <code>curl https://markaestro.com/llms.txt</code> returns a plain-text brief of the whole API —
                  endpoints, rules, and error handling — small enough to sit in context.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── Recipes ─── */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">Recipes</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            The four workflows agents actually run
          </h2>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Publish and confirm</CardTitle>
                <CardDescription>
                  Create a draft, publish it explicitly, then poll the run. The only honest way to tell the operator
                  a post went out.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={publishRecipe} label="bash" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Audit and cancel the queue</CardTitle>
                <CardDescription>
                  List what is scheduled, show it to a human, delete what they reject. Both calls use scopes an
                  existing key already carries.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={auditRecipe} label="bash" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fill a week in one call</CardTitle>
                <CardDescription>
                  Batch create takes up to 25 posts and returns per-item results, so a single malformed item does
                  not sink the run.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={batchRecipe} label="bash" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Get called instead of polling</CardTitle>
                <CardDescription>
                  Long-running agents should register a webhook and sleep. Deliveries are HMAC-signed with a secret
                  shown once at creation.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={webhookRecipe} label="bash" />
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── Guardrails ─── */}
      <section className="border-t" style={{ background: "var(--mk-paper)" }}>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">Guardrails</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            What the agent can and cannot do
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Autonomy is only useful if the blast radius is small. Markaestro&apos;s defaults assume the caller is
            software that might be wrong.
          </p>

          <div
            className="mt-10 rounded-xl border p-6"
            style={{ borderColor: "var(--mk-accent)", background: "var(--mk-accent-soft)" }}
          >
            <p className="text-sm font-semibold" style={{ color: "var(--mk-accent)" }}>
              Facebook, Instagram, and TikTok are manual-first
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--mk-ink-80)" }}>
              Posts your agent creates for those channels default to <code>manual_reminder</code>: Markaestro never
              calls the platform&apos;s API for them. Publishing moves the post into the workspace&apos;s To Post
              queue, where a person downloads the media, posts natively, and confirms — so the post looks exactly
              like it was made by hand, and a human sees every one before it exists publicly. An agent can opt a
              single post into official-API publishing with{" "}
              <code>deliveryMode: &quot;direct_publish&quot;</code>, and on TikTok that means the creator-inbox
              handoff, never an unattended public post. LinkedIn, Threads, and Pinterest publish programmatically
              once your agent explicitly asks.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {guardrails.map((item) => (
              <div key={item.title} className="rounded-xl border p-5">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Errors ─── */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">Failure handling</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            Teach it which errors are worth retrying
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Every error response is JSON with a stable <code>error</code> code and a <code>requestId</code>. Have
            your agent quote the requestId when it reports a failure — it is what support needs to trace the call.
          </p>

          <div className="mt-8 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">What the agent should do</th>
                </tr>
              </thead>
              <tbody>
                {errorRows.map((row) => (
                  <tr key={`${row.status}-${row.code}`} className="border-b last:border-0">
                    <td className="px-4 py-3 align-top font-mono text-[12px]">{row.status}</td>
                    <td className="px-4 py-3 align-top font-mono text-[12px]" style={{ color: "var(--mk-accent)" }}>
                      {row.code}
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Stacks ─── */}
      <section className="border-t" style={{ background: "var(--mk-paper)" }}>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">Bring your own stack</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            If it can make an HTTPS request, it can publish
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            There is no Markaestro client library to adopt and no framework to standardize on. Bearer token, JSON
            in, JSON out.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {stacks.map((stack) => (
              <div key={stack.name} className="rounded-xl border p-5">
                <p className="text-sm font-medium">{stack.name}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{stack.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="border-t" style={{ background: "var(--mk-ink)", borderColor: "var(--mk-rule)" }}>
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              className="text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
              style={{ color: "var(--mk-paper)", letterSpacing: "-0.03em" }}
            >
              Give your agent something real to do
            </h2>
            <p
              className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
              style={{
                color: "color-mix(in oklch, var(--mk-paper) 70%, transparent)",
                letterSpacing: "-0.005em",
              }}
            >
              Connect your channels, mint a brand-scoped key, and hand it over. The quickstart above is the entire
              integration.
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link href="/onboarding">
                <Button
                  size="lg"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{ background: "var(--mk-paper)", color: "var(--mk-ink)" }}
                >
                  Start for free
                </Button>
              </Link>
              <Link href="/developers/api">
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{ color: "color-mix(in oklch, var(--mk-paper) 80%, transparent)" }}
                >
                  Read the API reference
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
