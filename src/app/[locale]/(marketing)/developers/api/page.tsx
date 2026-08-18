"use client";

import { Link } from "@/i18n/navigation";
import NextLink from "next/link";
import { useTranslations } from "next-intl";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Endpoint paths, HTTP methods, and code samples are technical artifacts —
// stable across every locale, so they're kept out of the message catalog
// entirely (same approach as the curl snippets on every other page).
const examplesCode = {
  listProducts: `curl "$MARKAESTRO_URL/api/public/v1/products" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"`,
  listDestinations: `curl "$MARKAESTRO_URL/api/public/v1/products/prod_123/destinations" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"`,
  upload: `# 1. Create a 15-minute upload session
UPLOAD=$(curl -s -X POST "$MARKAESTRO_URL/api/public/v1/media/upload-sessions" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"fileName":"launch-1.jpg","contentType":"image/jpeg","sizeBytes":184320}')

# 2. PUT bytes directly to uploadSession.uploadUrl with its returned headers
curl -X PUT "<upload_url>" -H "Content-Type: image/jpeg" --data-binary @launch-1.jpg

# 3. Finalize; the response contains asset.id for mediaAssetIds
curl -X POST "$MARKAESTRO_URL/api/public/v1/media/upload-sessions/<session_id>/finalize" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"`,
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
  listScheduled: `# The key is already bound to one brand
curl "$MARKAESTRO_URL/api/public/v1/posts?status=scheduled&limit=100" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"

# Cancel one
curl -X DELETE "$MARKAESTRO_URL/api/public/v1/posts/pst_123" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"`,
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

const webhookExampleCode = `{
  "id": "evt_123",
  "type": "post.action_required",
  "createdAt": "2026-04-08T18:06:10.000Z",
  "workspaceId": "ws_123",
  "data": {
    "postId": "pst_123",
    "channel": "instagram",
    "status": "platform_action_required",
    "nextAction": "post_manually_from_reminder"
  }
}`;

const connectExampleCode = `# 1. List connected accounts
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

type Endpoint = { method: string; path: string; note: string };
type EndpointGroup = { title: string; description: string; endpoints: Endpoint[] };
type HighlightCard = { title: string; description: string };
type ChannelRule = { name: string; rule: string };

const codeTag = { code: (chunks: React.ReactNode) => <code>{chunks}</code> };
const codeAndStrongTags = { ...codeTag, strong: (chunks: React.ReactNode) => <strong className="text-foreground">{chunks}</strong> };

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
  return (
    <div className="rounded-xl border p-4">
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
  );
}

export default function DevelopersApiPage() {
  const t = useTranslations("developersApi");
  const connectEndpoints = t.raw("connectApi.endpoints") as Endpoint[];
  const highlightCards = t.raw("highlightCards") as HighlightCard[];
  const endpointGroups = t.raw("endpointGroups") as EndpointGroup[];
  const channels = t.raw("channelBehavior.channels") as ChannelRule[];

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <p className="mk-eyebrow">{t("hero.eyebrow")}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.03em] leading-[1.08] lg:text-5xl">
            {t("hero.title")}
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground">
            {t.rich("hero.intro1", {
              code: (chunks) => <code>{chunks}</code>,
              connectLink: (chunks) => <a href="#connect-api" className="underline underline-offset-2">{chunks}</a>,
            })}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t.rich("hero.intro2", codeTag)}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t.rich("hero.intro3", codeAndStrongTags)}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t("hero.intro4")}
          </p>
          <div
            className="mt-8 rounded-xl border p-5"
            style={{ borderColor: "var(--mk-accent)", background: "var(--mk-accent-soft)" }}
          >
            <p className="text-sm font-semibold" style={{ color: "var(--mk-accent)" }}>
              {t("hero.agentCallout.title")}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: "var(--mk-ink-80)" }}>
              {t.rich("hero.agentCallout.body", {
                agentLink: (chunks) => <Link href="/developers/agents" className="underline underline-offset-2">{chunks}</Link>,
                llmsLink: (chunks) => <a href="/llms.txt" className="underline underline-offset-2">{chunks}</a>,
              })}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/developers/agents">
              <Button className="rounded-lg h-9 text-[13px]">{t("hero.agentGuideButton")}</Button>
            </Link>
            {/* /settings lives on the (app) group, outside the [locale] segment —
                a plain <a> is intentional, not a Link candidate. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/settings?tab=api">
              <Button variant="outline" className="rounded-lg h-9 text-[13px]">{t("hero.manageKeysButton")}</Button>
            </a>
            <NextLink href="/login">
              <Button variant="ghost" className="rounded-lg h-9 text-[13px]">{t("hero.openAppButton")}</Button>
            </NextLink>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <Card id="connect-api" className="scroll-mt-24" style={{ borderColor: "var(--mk-accent)" }}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>{t("connectApi.title")}</CardTitle>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--mk-accent-soft)", color: "var(--mk-accent)" }}>{t("connectApi.recommendedBadge")}</span>
              </div>
              <CardDescription>
                {t.rich("connectApi.description", codeTag)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {connectEndpoints.map((endpoint) => (
                <EndpointRow key={endpoint.path} endpoint={endpoint} />
              ))}
              <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{connectExampleCode}</code></pre>
              <p className="text-sm text-muted-foreground">
                {t.rich("connectApi.footnote", codeAndStrongTags)}
              </p>
            </CardContent>
          </Card>

          <div className="mt-16 mb-2">
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">{t("advancedSection.title")}</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {t.rich("advancedSection.description", codeTag)}
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {highlightCards.map((card, i) => (
              <Card key={card.title} className={i === highlightCards.length - 1 ? "lg:col-span-3" : undefined}>
                <CardHeader>
                  <CardTitle>{card.title}</CardTitle>
                  <CardDescription>{card.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
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
                    <EndpointRow key={endpoint.path} endpoint={endpoint} />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("examples.listProducts.title")}</CardTitle>
                <CardDescription>{t("examples.listProducts.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examplesCode.listProducts}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("examples.listDestinations.title")}</CardTitle>
                <CardDescription>{t.rich("examples.listDestinations.description", codeTag)}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examplesCode.listDestinations}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("examples.upload.title")}</CardTitle>
                <CardDescription>{t("examples.upload.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examplesCode.upload}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("examples.createPost.title")}</CardTitle>
                <CardDescription>{t.rich("examples.createPost.description", codeTag)}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examplesCode.createPost}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("examples.tiktokCreatePost.title")}</CardTitle>
                <CardDescription>{t.rich("examples.tiktokCreatePost.description", codeTag)}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examplesCode.tiktokCreatePost}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("examples.publish.title")}</CardTitle>
                <CardDescription>{t.rich("examples.publish.description", codeTag)}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examplesCode.publish}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("examples.listScheduled.title")}</CardTitle>
                <CardDescription>{t.rich("examples.listScheduled.description", codeTag)}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{examplesCode.listScheduled}</code></pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("examples.webhook.title")}</CardTitle>
                <CardDescription>{t("examples.webhook.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg p-4 text-[12px] leading-6" style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}><code>{webhookExampleCode}</code></pre>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-12">
            <CardHeader>
              <CardTitle>{t("channelBehavior.title")}</CardTitle>
              <CardDescription>{t("channelBehavior.description")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {channels.map((channel) => (
                <div key={channel.name} className="rounded-xl border p-4">
                  <p className="text-sm font-medium">{channel.name}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{channel.rule}</p>
                </div>
              ))}
            </CardContent>
          </Card>

        </div>
      </section>
    </MarketingLayout>
  );
}
