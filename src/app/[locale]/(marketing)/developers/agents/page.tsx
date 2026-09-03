/**
 * /developers/agents — the AI agent integration guide.
 *
 * Deliberately a server component (unlike the other marketing pages) so it can
 * export real metadata: this is the page an agent builder searches for, and it
 * is also the page an LLM crawls. The interactive bits (copy buttons) live in
 * the CopyBlock client component.
 */

import type { Metadata } from "next";
import NextLink from "next/link";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import MarketingLayout from "@/components/layout/MarketingLayout";
import CopyBlock from "@/components/marketing/CopyBlock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("developersAgents.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "https://markaestro.com/developers/agents" },
    openGraph: {
      title: t("ogTitle"),
      description: t("ogDescription"),
      url: "https://markaestro.com/developers/agents",
      type: "article",
    },
  };
}

/* ─── Code artifacts ──────────────────────────────────────────────────────
 * Every string below is either a literal API path/method or content meant to
 * be pasted verbatim into an agent (curl commands, JSON tool schemas, a
 * system-prompt brief). None of it is translated — same reasoning as
 * public/llms.txt: it's addressed to software, not to the page's reader.
 * ────────────────────────────────────────────────────────────────────── */

const mcpClaudeCode = `# Claude Code: the plugin bundles the skill and the hosted server.
claude plugin marketplace add D3vBaba/Markaestro
claude plugin install markaestro@markaestro

# Or add just the server. No key, no header: the first call opens the browser.
claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp`;

const mcpGenericConfig = `{
  "mcpServers": {
    "markaestro": {
      "type": "http",
      "url": "https://markaestro.com/api/public/v1/mcp"
    }
  }
}`;

const mcpHeadless = `# CI, cron, or any client without a browser: pass a key instead.
claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp \\
  --header "Authorization: Bearer mk_live_..."

# Local stdio server (can also upload files from disk)
claude mcp add markaestro -e MARKAESTRO_API_KEY=mk_live_... -- npx -y @markaestro/mcp`;

const mcpFlowEndpoints = [
  "POST /api/public/v1/mcp → 401 + WWW-Authenticate",
  "GET /.well-known/oauth-protected-resource · /.well-known/oauth-authorization-server",
  "POST /api/public/v1/oauth/register",
  "GET /oauth/authorize (browser)",
  "POST /api/public/v1/oauth/token",
];

const mcpEndpointTable = `# Discovery (public, cacheable)
GET  /.well-known/oauth-protected-resource            RFC 9728
GET  /.well-known/oauth-authorization-server          RFC 8414

# Authorization server
POST /api/public/v1/oauth/register                    RFC 7591, public clients (PKCE) or client_secret
GET  /oauth/authorize?response_type=code&client_id=…&redirect_uri=…
                     &code_challenge=…&code_challenge_method=S256&state=…
POST /api/public/v1/oauth/token                       grant_type=authorization_code | refresh_token
POST /api/public/v1/oauth/revoke                      RFC 7009

# Token response
{ "access_token": "mk_live_<ws>.<client>.<secret>", "token_type": "Bearer",
  "expires_in": 2592000, "refresh_token": "…", "scope": "products.read posts.write …" }`;

const agentLoopEndpoints = [
  "GET /api/connect/v1/social-accounts",
  "POST /api/connect/v1/media/create-upload-url → PUT",
  "POST /api/connect/v1/posts",
  "POST /api/public/v1/posts/:id/publish",
  "GET /api/public/v1/job-runs/:id · webhooks",
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
    "description": "List the social accounts this Markaestro key can publish to. Call this first in every run. Never hardcode account ids. Returns id, platform, and username.",
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
          "enum": ["facebook", "instagram", "tiktok", "linkedin", "threads", "pinterest", "x"]
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
    "description": "Queue an async publish run for an existing post. Returns a run id. Poll it, do not assume the post is live.",
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
  them queues a reminder for a human. That is the intended behavior. Only
  send deliveryMode "direct_publish" if the operator explicitly asked for it.
- Send a unique Idempotency-Key on every POST. Reuse the SAME key when
  retrying the SAME request; never reuse it for a different one.
- On 429, wait the number of seconds in Retry-After, then retry. On 4xx other
  than 429, do not retry. Report the error code and requestId and stop.
- Publishing is async. POST /publish returns a run id; poll
  GET /api/public/v1/job-runs/<id> until succeeded or failed.
- To cancel, list with ?status=scheduled and DELETE the post id. Deleting a
  published post does not remove it from the platform.
- Never claim a post is live until a run reports succeeded or a post reports
  published.`;

const publishRecipe = `# Full control: draft → publish → poll. No productId needed:
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

const batchRecipe = `# One call, up to 25 posts. Per-item results: one bad item
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

/* ─── Types ────────────────────────────────────────────────────────────── */

type Card1 = { title: string; body: string };
type LoopStep = { step: string; title: string; body: string };
type McpStep = { step: string; title: string; body: string };
type McpFact = { title: string; body: string };
type Guardrail = { title: string; body: string };
type ErrorRow = { status: string; code: string; action: string };
type Stack = { name: string; body: string };

const codeTag = { code: (chunks: React.ReactNode) => <code>{chunks}</code> };

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default async function DevelopersAgentsPage() {
  const t = await getTranslations("developersAgents");
  const whyCards = t.raw("why.cards") as Card1[];
  const loopSteps = t.raw("loop.steps") as LoopStep[];
  const guardrailItems = t.raw("guardrails.items") as Guardrail[];
  const errorRows = t.raw("errors.rows") as ErrorRow[];
  const stacks = t.raw("stacks.items") as Stack[];
  const mcpSteps = t.raw("mcp.steps") as McpStep[];
  const mcpFacts = t.raw("mcp.facts") as McpFact[];

  return (
    <MarketingLayout>
      {/* ─── Hero ─── */}
      <section className="border-b bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <p className="mk-eyebrow">{t("hero.eyebrow")}</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.03em] leading-[1.08] lg:text-5xl">
            {t("hero.title")}
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground">
            {t("hero.intro1")}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t("hero.intro2")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {/* /settings lives on the (app) group, outside the [locale] segment —
                a plain <a> is intentional, not a Link candidate. */}
            <a href="#connect-mcp">
              <Button className="rounded-lg h-9 text-[13px]">{t("hero.connectMcpButton")}</Button>
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/settings?tab=api">
              <Button variant="outline" className="rounded-lg h-9 text-[13px]">{t("hero.createKeyButton")}</Button>
            </a>
            <Link href="/developers/api">
              <Button variant="outline" className="rounded-lg h-9 text-[13px]">
                {t("hero.apiReferenceButton")}
              </Button>
            </Link>
            <a href="/llms.txt">
              <Button variant="ghost" className="rounded-lg h-9 text-[13px]">
                {t("hero.machineBriefButton")}
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ─── Why ─── */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="max-w-3xl">
            <p className="mk-eyebrow">{t("why.eyebrow")}</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
              {t("why.title")}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {t("why.intro")}
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

      {/* ─── MCP: sign in from the client ─── */}
      <section id="connect-mcp" className="border-t scroll-mt-24">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">{t("mcp.eyebrow")}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            {t("mcp.title")}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t("mcp.intro1")}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t.rich("mcp.intro2", codeTag)}
          </p>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("mcp.installTitle")}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {t("mcp.installDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CopyBlock code={mcpClaudeCode} label={t("mcp.bashLabel")} />
                <CopyBlock code={mcpGenericConfig} label={t("mcp.configLabel")} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("mcp.headlessTitle")}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {t("mcp.headlessDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={mcpHeadless} label={t("mcp.bashLabel")} />
              </CardContent>
            </Card>
          </div>

          <h3 className="mt-14 text-lg font-semibold tracking-[-0.02em]">{t("mcp.flowTitle")}</h3>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t("mcp.flowIntro")}
          </p>
          <div className="mt-6 grid gap-3">
            {mcpSteps.map((item, i) => (
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
                  <code className="text-[12px] break-all" style={{ color: "var(--mk-accent)" }}>
                    {mcpFlowEndpoints[i]}
                  </code>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {mcpFacts.map((fact) => (
              <div key={fact.title} className="rounded-xl border p-5">
                <p className="text-sm font-medium">{fact.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{fact.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <p className="text-sm font-medium">{t("mcp.endpointsTitle")}</p>
            <p className="mt-2 mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {t("mcp.endpointsDescription")}
            </p>
            <CopyBlock code={mcpEndpointTable} label={t("mcp.endpointsLabel")} />
          </div>
        </div>
      </section>

      {/* ─── The loop ─── */}
      <section className="border-t" style={{ background: "var(--mk-paper)" }}>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">{t("loop.eyebrow")}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            {t("loop.title")}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t.rich("loop.intro", {
              ...codeTag,
              connectLink: (chunks) => <Link href="/developers/api#connect-api" className="underline underline-offset-2">{chunks}</Link>,
            })}
          </p>

          <div className="mt-10 grid gap-3">
            {loopSteps.map((item, i) => (
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
                    {agentLoopEndpoints[i]}
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
          <p className="mk-eyebrow">{t("quickstart.eyebrow")}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            {t("quickstart.title")}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t.rich("quickstart.intro", {
              // /settings is an (app) route outside the [locale] segment.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              settingsLink: (chunks) => <a href="/settings?tab=api" className="underline underline-offset-2">{chunks}</a>,
            })}
          </p>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("quickstart.step1.title")}</CardTitle>
                  <CardDescription>
                    {t("quickstart.step1.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CopyBlock code={quickstartShell} label={t("quickstart.bashLabel")} />
                  <CopyBlock code={quickstartAccounts} label={t("quickstart.responseLabel")} />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("quickstart.step2.title")}</CardTitle>
                  <CardDescription>
                    {t("quickstart.step2.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CopyBlock code={quickstartUpload} label={t("quickstart.bashLabel")} />
                </CardContent>
              </Card>
            </div>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">{t("quickstart.step3.title")}</CardTitle>
                <CardDescription>
                  {t.rich("quickstart.step3.description", codeTag)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={quickstartPost} label={t("quickstart.bashLabel")} />
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── Tool definitions ─── */}
      <section className="border-t" style={{ background: "var(--mk-paper)" }}>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">{t("toolDefs.eyebrow")}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            {t("toolDefs.title")}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t("toolDefs.intro")}
          </p>

          <div className="mt-10 grid gap-6 lg:grid-cols-2 lg:items-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("toolDefs.schemasTitle")}</CardTitle>
                <CardDescription>
                  {t("toolDefs.schemasDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[560px] overflow-y-auto">
                  <CopyBlock code={toolDefinitions} label={t("toolDefs.schemasLabel")} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("toolDefs.briefTitle")}</CardTitle>
                <CardDescription>
                  {t("toolDefs.briefDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CopyBlock code={agentBrief} label={t("toolDefs.briefLabel")} />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t.rich("toolDefs.briefFooter", codeTag)}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── Recipes ─── */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">{t("recipes.eyebrow")}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            {t("recipes.title")}
          </h2>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("recipes.publish.title")}</CardTitle>
                <CardDescription>
                  {t("recipes.publish.description")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={publishRecipe} label={t("recipes.bashLabel")} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("recipes.audit.title")}</CardTitle>
                <CardDescription>
                  {t("recipes.audit.description")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={auditRecipe} label={t("recipes.bashLabel")} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("recipes.batch.title")}</CardTitle>
                <CardDescription>
                  {t("recipes.batch.description")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={batchRecipe} label={t("recipes.bashLabel")} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("recipes.webhook.title")}</CardTitle>
                <CardDescription>
                  {t("recipes.webhook.description")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CopyBlock code={webhookRecipe} label={t("recipes.bashLabel")} />
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── Guardrails ─── */}
      <section className="border-t" style={{ background: "var(--mk-paper)" }}>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <p className="mk-eyebrow">{t("guardrails.eyebrow")}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            {t("guardrails.title")}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t("guardrails.intro")}
          </p>

          <div
            className="mt-10 rounded-xl border p-6"
            style={{ borderColor: "var(--mk-accent)", background: "var(--mk-accent-soft)" }}
          >
            <p className="text-sm font-semibold" style={{ color: "var(--mk-accent)" }}>
              {t("guardrails.calloutTitle")}
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--mk-ink-80)" }}>
              {t.rich("guardrails.calloutBody", codeTag)}
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {guardrailItems.map((item) => (
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
          <p className="mk-eyebrow">{t("errors.eyebrow")}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            {t("errors.title")}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t.rich("errors.intro", codeTag)}
          </p>

          <div className="mt-8 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-start">
                  <th className="px-4 py-3 font-medium">{t("errors.statusHeader")}</th>
                  <th className="px-4 py-3 font-medium">{t("errors.codeHeader")}</th>
                  <th className="px-4 py-3 font-medium">{t("errors.actionHeader")}</th>
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
          <p className="mk-eyebrow">{t("stacks.eyebrow")}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] lg:text-3xl">
            {t("stacks.title")}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t("stacks.intro")}
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
              {t("cta.title")}
            </h2>
            <p
              className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
              style={{
                color: "color-mix(in oklch, var(--mk-paper) 70%, transparent)",
                letterSpacing: "-0.005em",
              }}
            >
              {t("cta.subtitle")}
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <NextLink href="/onboarding">
                <Button
                  size="lg"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{ background: "var(--mk-paper)", color: "var(--mk-ink)" }}
                >
                  {t("cta.primaryButton")}
                </Button>
              </NextLink>
              <Link href="/developers/api">
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{ color: "color-mix(in oklch, var(--mk-paper) 80%, transparent)" }}
                >
                  {t("cta.secondaryButton")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
