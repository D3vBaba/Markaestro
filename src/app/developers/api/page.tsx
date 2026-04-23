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
      { method: "GET", path: "/api/public/v1/products/:id/destinations", note: "Lists the publish destinations for that product, including standalone Instagram Login destinations, Meta fan-out behavior, and connected TikTok destinations." },
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
    description: "Create, inspect, and publish posts for Facebook, Instagram, TikTok, and LinkedIn.",
    endpoints: [
      { method: "POST", path: "/api/public/v1/posts", note: "Creates a draft or scheduled post in the workspace." },
      { method: "GET", path: "/api/public/v1/posts/:id", note: "Returns current post status, publish results, and any follow-up action such as completing a TikTok inbox handoff." },
      { method: "POST", path: "/api/public/v1/posts/:id/publish", note: "Queues an async publish run. TikTok uses the same direct inbox handoff as the app, then finishes asynchronously once TikTok reports the draft is ready." },
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
  "type": "post.exported_for_review",
  "createdAt": "2026-04-08T18:06:10.000Z",
  "workspaceId": "ws_123",
  "data": {
    "postId": "pst_123",
    "channel": "tiktok",
    "status": "exported_for_review",
    "externalId": "p_inbox_url~v2.7631796255831721997",
    "nextAction": "open_tiktok_inbox_and_complete_editing"
  }
}`;

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
            Upload images and videos, create posts, publish directly to Meta, Instagram, LinkedIn,
            and hand TikTok content off to the creator&apos;s TikTok inbox using the same direct flow as the app.
            Public API v1 is workspace-scoped, supports images and video, and is designed for async automation.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            For TikTok, publish is still asynchronous: the run starts the inbox push immediately, then the worker updates the post once TikTok finishes processing and the creator can complete it in TikTok.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Use only the versioned public routes under <code>/api/public/v1</code>. Internal app routes such as <code>/api/workspaces</code>,
            <code>/api/posts</code>, <code>/api/integrations</code>, and <code>/api/analytics</code> require Firebase user auth and are not part of the public API contract.
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
                <CardTitle>TikTok mirrors the app flow</CardTitle>
                <CardDescription>TikTok photo and video posts use the same direct inbox handoff as the Markaestro UI. Once TikTok is ready, the post moves to review so the creator can finish it inside TikTok.</CardDescription>
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
                <CardDescription>See the linked pages and accounts for a product before creating the post. Use the returned <code>destinationId</code> when a product has more than one Instagram destination.</CardDescription>
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
                <CardDescription>Create a draft or scheduled post using those asset ids.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examples.createPost}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>TikTok example</CardTitle>
                <CardDescription>Use the connected TikTok destination returned for the product. Publishing this post follows the same inbox handoff flow as the app.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examples.tiktokCreatePost}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>5. Queue publish</CardTitle>
                <CardDescription>Publishing always creates an async run. TikTok runs finish after the media is handed off and TikTok reports the inbox draft is ready for creator review.</CardDescription>
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
                <p className="mt-2 text-sm text-muted-foreground">At least one image or video. Up to 10 images or 1 video. Publishing pushes to the creator&apos;s TikTok inbox first, then marks the post ready for review once TikTok finishes processing.</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">LinkedIn</p>
                <p className="mt-2 text-sm text-muted-foreground">Text-only, image, or video posts. Up to 20 images or 1 video per post. Direct publish.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </MarketingLayout>
  );
}
