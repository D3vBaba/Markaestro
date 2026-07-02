"use client";

import Link from "next/link";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const endpointGroups = [
  {
    title: "Products and destinations",
    description: "Discover the products and publish destinations available to the API key.",
    endpoints: [
      { method: "GET", path: "/api/public/v1/products", note: "Lists products plus the channels currently available for each one." },
      { method: "GET", path: "/api/public/v1/products/:id/destinations", note: "Lists the publish destinations for that product, including standalone Instagram Login, Facebook Page, Threads, LinkedIn Profile/Page, and connected TikTok destinations." },
    ],
  },
  {
    title: "Media",
    description: "Upload images or videos to Markaestro-managed storage before creating posts.",
    endpoints: [
      { method: "POST", path: "/api/public/v1/media", note: "Multipart upload. Returns an asset id and hosted URL." },
    ],
  },
  {
    title: "Posts",
    description: "Create, inspect, and publish posts for Facebook, Instagram, LinkedIn, Threads, Pinterest, and TikTok.",
    endpoints: [
      { method: "POST", path: "/api/public/v1/posts", note: "Creates a draft in the workspace for the selected product destination." },
      { method: "GET", path: "/api/public/v1/posts/:id", note: "Returns current post status and publish results." },
      { method: "POST", path: "/api/public/v1/posts/:id/publish", note: "Queues an async publish run. Facebook, Instagram, LinkedIn, Threads, and Pinterest publish directly; TikTok uses the inbox handoff and still requires creator completion in TikTok." },
    ],
  },
  {
    title: "Runs and Webhooks",
    description: "Track async work with polling or signed webhook delivery.",
    endpoints: [
      { method: "GET", path: "/api/public/v1/job-runs/:id", note: "Returns queued, running, succeeded, or failed." },
      { method: "POST", path: "/api/public/v1/webhook-endpoints", note: "Registers a webhook destination using an API key." },
      { method: "GET", path: "/api/public/v1/webhook-endpoints", note: "Lists registered webhook destinations for that API key scope." },
      { method: "DELETE", path: "/api/public/v1/webhook-endpoints/:id", note: "Disables a webhook destination." },
    ],
  },
];

const examples = {
  listProducts: `curl "$MARKAESTRO_URL/api/public/v1/products" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"`,
  listDestinations: `curl "$MARKAESTRO_URL/api/public/v1/products/prod_123/destinations" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"`,
  upload: `curl -X POST "$MARKAESTRO_URL/api/public/v1/media" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Idempotency-Key: upload-001" \\
  -F "file=@launch-1.jpg"`,
  createPost: `curl -X POST "$MARKAESTRO_URL/api/public/v1/posts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: post-001" \\
  -d '{
    "channel": "instagram",
    "caption": "Launch day carousel",
    "mediaAssetIds": ["ast_123", "ast_124"],
    "productId": "prod_123",
    "destinationId": "instagram:instagram:ig_123"
  }'`,
  publish: `curl -X POST "$MARKAESTRO_URL/api/public/v1/posts/pst_123/publish" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Idempotency-Key: publish-001"`,
  tiktokCreatePost: `curl -X POST "$MARKAESTRO_URL/api/public/v1/posts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: post-tt-001" \\
  -d '{
    "channel": "tiktok",
    "caption": "Spring drop teaser",
    "mediaAssetIds": ["ast_vid_123"],
    "productId": "prod_123",
    "destinationId": "tiktok:tiktok:tt_open_123"
  }'`,
};

const webhookExample = `{
  "id": "evt_123",
  "type": "post.action_required",
  "createdAt": "2026-04-08T18:06:10.000Z",
  "workspaceId": "ws_123",
  "data": {
    "postId": "pst_123",
    "channel": "tiktok",
    "status": "platform_action_required",
    "externalId": "p_inbox_url~v2.7631796255831721997",
    "nextAction": "open_tiktok_inbox_and_complete_posting"
  }
}`;

const connectEndpoints = [
  { method: "GET", path: "/api/connect/v1/social-accounts", note: "Lists connected Facebook, Instagram, TikTok, LinkedIn, and Threads destinations as flat accounts, each labeled with its product so clients can group and disambiguate. Each channel is its own dedicated path — no cross-channel fan-out." },
  { method: "GET", path: "/api/connect/v1/products", note: "Lists products with their connected accounts nested — a product-first picker." },
  { method: "POST", path: "/api/connect/v1/media/create-upload-url", note: "Returns a short-lived, single-use signed PUT url plus a media id." },
  { method: "PUT", path: "<upload_url>", note: "Upload the raw image bytes to the signed url. No API key needed — the signature authorizes it." },
  { method: "POST", path: "/api/connect/v1/posts", note: "Creates a draft per selected account. snake_case body: media, social_accounts, scheduled_at, is_draft; scheduling fields are accepted for compatibility and ignored." },
  { method: "GET", path: "/api/connect/v1/posts", note: "Lists workspace posts with flat status, caption, and media urls." },
];

const connectExample = `# 1. List connected accounts
curl "$MARKAESTRO_URL/api/connect/v1/social-accounts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"

# 2. Request a signed upload url, then PUT the bytes
curl -X POST "$MARKAESTRO_URL/api/connect/v1/media/create-upload-url" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "mime_type": "image/png", "size_bytes": 184320, "name": "slide-1.png" }'
curl -X PUT "<upload_url>" -H "Content-Type: image/png" --data-binary @slide-1.png

# 3. Create a draft post for one or more accounts
curl -X POST "$MARKAESTRO_URL/api/connect/v1/posts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "caption": "New drop",
    "media": ["ast_111", "ast_222"],
    "social_accounts": ["prod_123#instagram:instagram:ig_123"]
  }'`;

export default function DevelopersApiPage() {
  return (
    <MarketingLayout>
      <section className="border-b bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <p className="mk-eyebrow">Developers</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.03em] leading-[1.08] lg:text-5xl">
            Public publishing API
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Upload media, create posts, and publish to Facebook, Instagram, LinkedIn, Threads, and Pinterest, all scoped to a product via a workspace
            API key. The recommended way to integrate is the{" "}
            <a href="#connect-api" className="underline underline-offset-2">Connect API</a> — a small, flat
            <code>/api/connect/v1</code> surface that most scheduling tools can target as-is.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Need full control — explicit publish, job-run polling, signed webhooks, batch, per-channel settings? The
            advanced <code>/api/public/v1</code> API further down exposes all of it. Both share the same auth, products,
            and publishing pipeline; use only these versioned public routes (internal app routes require Firebase user
            auth and are not part of the public contract).
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">TikTok is draft-first over the API.</strong> A TikTok post is always
            created as a draft in Markaestro. Explicit publish uses TikTok&apos;s inbox handoff, never public Direct Post,
                and the creator finalizes inside TikTok. Facebook, Instagram, LinkedIn, Threads, and Pinterest publish programmatically.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Workspaces can have multiple products. Every API key is bound to one product when you create it, so calls
            target that product automatically and requests for any other product are rejected.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login">
              <Button className="rounded-lg h-9 text-[13px]">Open Markaestro</Button>
            </Link>
            <a href="/settings?tab=api">
              <Button variant="outline" className="rounded-lg h-9 text-[13px]">Manage API keys</Button>
            </a>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <Card id="connect-api" className="scroll-mt-24" style={{ borderColor: "var(--mk-accent)" }}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Connect API</CardTitle>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--mk-accent-soft)", color: "var(--mk-accent)" }}>Recommended</span>
              </div>
              <CardDescription>
                The default way to integrate: a flat, snake_case surface at <code>/api/connect/v1</code> that most
                scheduling tools can target as-is. It maps the common <code>create-upload-url → PUT → post</code>{" "}
                convention onto the same workspace, auth, products, and publishing pipeline as the full API below. Set
                the client base URL to <code>/api/connect</code> and authenticate with a product-scoped workspace API key
                (scopes <code>posts.read</code>, <code>posts.write</code>, <code>media.write</code>).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {connectEndpoints.map((endpoint) => (
                <div key={endpoint.path} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className="rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold"
                      style={{
                        background: "var(--mk-accent-soft)",
                        color: "var(--mk-accent)",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {endpoint.method}
                    </span>
                    <code className="text-sm">{endpoint.path}</code>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{endpoint.note}</p>
                </div>
              ))}
              <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{connectExample}</code></pre>
              <p className="text-sm text-muted-foreground">
                Each account from <code>/social-accounts</code> is labeled with its <code>product</code> (the same account can
                appear under multiple products), and its <code>id</code> encodes <code>productId#destinationId</code> — pass it
                back verbatim in <code>social_accounts</code>, and the request fans out one post per account. Each key is
                bound to one product, so it only sees and posts to that product. <strong className="text-foreground">TikTok
                posts are created as drafts</strong> and finalized from the Markaestro app; Facebook, Instagram, LinkedIn, Threads, and Pinterest publish
                programmatically after an explicit publish action. Post status is one of <code>draft</code>, <code>processing</code>,{" "}
                <code>posted</code>, or <code>failed</code>. Facebook, Instagram, LinkedIn, TikTok, and Threads are each their own dedicated
                destination — publishing to one never fans out to another. Track publishing state through{" "}
                <code>GET /api/connect/v1/posts</code>.
              </p>
            </CardContent>
          </Card>

          <div className="mt-16 mb-2">
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">Advanced: full Public API</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              The complete <code>/api/public/v1</code> surface — explicit publish, async job runs, signed webhooks,
              batch create, and per-channel settings. Use it when the Connect API is not enough.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Meta publishes directly</CardTitle>
                <CardDescription>Facebook and Instagram complete inside Markaestro once the platform accepts the publish.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Instagram Login supported</CardTitle>
                <CardDescription>Products can expose standalone Instagram professional accounts even when no Facebook Page is linked.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>TikTok uses inbox handoff</CardTitle>
                <CardDescription>TikTok posts created via the API always land in your Markaestro drafts. Publishing sends them to the creator&apos;s TikTok inbox for final caption, privacy, and posting.</CardDescription>
              </CardHeader>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Async by design</CardTitle>
                <CardDescription>Every publish returns a run id. Poll runs or subscribe to signed webhooks instead of assuming synchronous completion.</CardDescription>
              </CardHeader>
            </Card>
          </div>

          <div className="mt-12 grid gap-8">
            {endpointGroups.map((group) => (
              <Card key={group.title}>
                <CardHeader>
                  <CardTitle>{group.title}</CardTitle>
                  <CardDescription>{group.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.endpoints.map((endpoint) => (
                    <div key={endpoint.path} className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className="rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold"
                          style={{
                            background: "var(--mk-accent-soft)",
                            color: "var(--mk-accent)",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {endpoint.method}
                        </span>
                        <code className="text-sm">{endpoint.path}</code>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{endpoint.note}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>1. List products</CardTitle>
                <CardDescription>Discover which products this API key can target.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examples.listProducts}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>2. Inspect destinations</CardTitle>
                <CardDescription>See the linked pages and accounts for a product before creating the post. Use the returned <code>destinationId</code> when a product has multiple destinations, such as a LinkedIn Profile plus Pages.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examples.listDestinations}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>3. Upload media</CardTitle>
                <CardDescription>Each post references previously uploaded media assets.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examples.upload}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>4. Create a post</CardTitle>
                <CardDescription>Create a draft using those asset ids.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examples.createPost}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>TikTok example</CardTitle>
                <CardDescription>Use the connected TikTok destination returned for the product. It reports platform_inbox delivery, lands as a Markaestro draft, and is sent to the creator&apos;s TikTok inbox only when publish is explicitly queued.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examples.tiktokCreatePost}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>5. Queue publish</CardTitle>
                <CardDescription>Publishing creates an async run. Facebook, Instagram, LinkedIn, Threads, and Pinterest publish directly; TikTok queues the inbox handoff and returns action-required when TikTok accepts it.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examples.publish}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Webhook payload example</CardTitle>
                <CardDescription>Deliveries are signed with HMAC using your webhook secret.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{webhookExample}</code></pre>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-12">
            <CardHeader>
              <CardTitle>Channel behavior</CardTitle>
              <CardDescription>Validation and delivery rules enforced by the public API.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">Facebook</p>
                <p className="mt-2 text-sm text-muted-foreground">Text-only, image, or video posts. Up to 10 images or 1 video per post. Direct publish.</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">Instagram</p>
                <p className="mt-2 text-sm text-muted-foreground">At least one image or video, up to 10 items. Single video publishes as a Reel. Carousels support mixed image/video.</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">TikTok</p>
                <p className="mt-2 text-sm text-muted-foreground">At least one image or video. Up to 10 images or 1 video. API posts are always created as drafts; explicit publish sends the draft to the creator&apos;s TikTok inbox, not public Direct Post.</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">LinkedIn</p>
                <p className="mt-2 text-sm text-muted-foreground">Text, single image, single video, or organic multi-image posts up to 20 images. Target either the connected Profile or a managed Page.</p>
              </div>
            </CardContent>
          </Card>

        </div>
      </section>
    </MarketingLayout>
  );
}
