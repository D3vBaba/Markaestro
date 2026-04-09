"use client";

import Link from "next/link";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const endpointGroups = [
  {
    title: "Media",
    description: "Upload images to Markaestro-managed storage before creating posts.",
    endpoints: [
      { method: "POST", path: "/api/public/v1/media", note: "Multipart upload. Returns an asset id and hosted URL." },
    ],
  },
  {
    title: "Posts",
    description: "Create, inspect, and publish posts for Facebook, Instagram, and TikTok.",
    endpoints: [
      { method: "POST", path: "/api/public/v1/posts", note: "Creates a draft or scheduled post in the workspace." },
      { method: "GET", path: "/api/public/v1/posts/:id", note: "Returns current post status, platform ids, and publish results." },
      { method: "POST", path: "/api/public/v1/posts/:id/publish", note: "Queues an async publish run. Required for immediate publish." },
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
  upload: `curl -X POST "$MARKAESTRO_URL/api/public/v1/media" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Idempotency-Key: upload-001" \\
  -F "file=@launch-1.jpg"`,
  createPost: `curl -X POST "$MARKAESTRO_URL/api/public/v1/posts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: post-001" \\
  -d '{
    "channel": "tiktok",
    "caption": "Launch day carousel",
    "mediaAssetIds": ["ast_123", "ast_124", "ast_125"]
  }'`,
  publish: `curl -X POST "$MARKAESTRO_URL/api/public/v1/posts/pst_123/publish" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Idempotency-Key: publish-001"`,
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
    "externalId": "publish_abc",
    "nextAction": "open_tiktok_inbox_and_complete_editing"
  }
}`;

export default function DevelopersApiPage() {
  return (
    <MarketingLayout>
      <section className="border-b bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Developers</p>
          <h1 className="mt-4 text-4xl font-normal tracking-tight lg:text-5xl font-[family-name:var(--font-display)]">
            Public publishing API
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Upload images, create posts, publish directly to Meta, and export TikTok carousels into the creator review flow.
            Public API v1 is workspace-scoped, image-only, capped at 10 images per post, and designed for async automation.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login">
              <Button>Open Markaestro</Button>
            </Link>
            <a href="/settings?tab=api">
              <Button variant="outline">Manage API keys</Button>
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
                <CardTitle>TikTok exports for review</CardTitle>
                <CardDescription>TikTok image posts are sent to the creator flow for manual editing and final posting inside TikTok.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
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
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
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
                <CardTitle>1. Upload media</CardTitle>
                <CardDescription>Each post references previously uploaded image assets.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-xl border bg-muted/30 p-4 text-xs leading-6"><code>{examples.upload}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>2. Create a post</CardTitle>
                <CardDescription>Create a draft or scheduled post using those asset ids.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-xl border bg-muted/30 p-4 text-xs leading-6"><code>{examples.createPost}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>3. Queue publish</CardTitle>
                <CardDescription>Publishing always creates an async run, even if Meta completes quickly.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-xl border bg-muted/30 p-4 text-xs leading-6"><code>{examples.publish}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Webhook payload example</CardTitle>
                <CardDescription>Deliveries are signed with HMAC using your webhook secret.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-xl border bg-muted/30 p-4 text-xs leading-6"><code>{webhookExample}</code></pre>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-12">
            <CardHeader>
              <CardTitle>Channel behavior</CardTitle>
              <CardDescription>Validation and delivery rules enforced by the public API.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">Facebook</p>
                <p className="mt-2 text-sm text-muted-foreground">Text-only or image posts, up to 10 images, direct publish.</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">Instagram</p>
                <p className="mt-2 text-sm text-muted-foreground">At least one image, up to 10 images, direct publish.</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">TikTok</p>
                <p className="mt-2 text-sm text-muted-foreground">At least one image, up to 10 images, exported into TikTok review flow. No video in v1.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </MarketingLayout>
  );
}
