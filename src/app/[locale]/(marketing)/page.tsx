"use client";

import NextLink from "next/link";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { useOptionalAuth } from "@/components/providers/AuthProvider";
import CopyBlock from "@/components/marketing/CopyBlock";
import Screenshot from "@/components/marketing/Screenshot";
import Underline from "@/components/marketing/Underline";
import Faq, { type FaqItem } from "@/components/marketing/Faq";
import WallOfLove from "@/components/marketing/WallOfLove";
import { ChannelGlyph } from "@/components/app/ChannelGlyph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Deliberately the shortest true version of the integration: discover, then
// schedule. Anything longer stops reading as "this is easy" on a landing page.
// A code artifact, not translatable prose — stays identical across locales.
const agentSnippet = `# 1. Which accounts can this key post to?
curl "$MARKAESTRO_URL/api/connect/v1/social-accounts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"

# 2. Put a post on the calendar.
curl -X POST "$MARKAESTRO_URL/api/connect/v1/posts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "caption": "Cold brew season starts Friday.",
    "media": ["ast_777"],
    "social_accounts": ["prod_123#instagram:instagram:ig_123"],
    "is_draft": false,
    "scheduled_at": "2026-08-14T15:00:00.000Z"
  }'`;

type ProofItem = { value: string; label: string };
type WhoItem = { title: string; desc: string };
type Tile = { id: "calendar" | "composer" | "analytics" | "brands" | "intelligence"; label: string; title: string; desc: string };

/** Folder under public/marketing holding the current capture set; bump when screenshots are re-captured so cached optimized images refresh. */
const SHOT_VERSION = "20260904c";

const TILE_IMAGES: Record<Tile["id"], { src: string; span: string }> = {
  calendar: { src: `/marketing/${SHOT_VERSION}/calendar.png`, span: "lg:col-span-7" },
  composer: { src: `/marketing/${SHOT_VERSION}/composer.png`, span: "lg:col-span-5" },
  analytics: { src: `/marketing/${SHOT_VERSION}/analytics.png`, span: "lg:col-span-5" },
  brands: { src: `/marketing/${SHOT_VERSION}/brands.png`, span: "lg:col-span-7" },
  intelligence: { src: `/marketing/${SHOT_VERSION}/intelligence.png`, span: "lg:col-span-12" },
};

const CHANNEL_WALL = ["instagram", "meta", "tiktok", "threads", "pinterest", "linkedin", "x"] as const;

function SectionTitle({ children, sub, className }: { children: React.ReactNode; sub?: string; className?: string }) {
  return (
    <div className={cn("mx-auto max-w-2xl text-center", className)}>
      <h2 className="m-0 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground text-balance sm:text-4xl lg:text-[44px]">
        {children}
      </h2>
      {sub ? <p className="m-0 mx-auto mt-4 max-w-xl text-[17px] leading-7 text-mk-ink-80 text-pretty">{sub}</p> : null}
    </div>
  );
}

export default function LandingPage() {
  const t = useTranslations("home");
  const tPricing = useTranslations("pricing");
  const { user } = useOptionalAuth();
  const proof = t.raw("proof.items") as ProofItem[];
  const whoFor = t.raw("whoFor.items") as WhoItem[];
  const tiles = t.raw("bento.tiles") as Tile[];
  const extras = t.raw("channelWall.extras") as { label: string }[];
  const agentBullets = t.raw("agentSection.bullets") as string[];
  const faqs = (tPricing.raw("faqs") as FaqItem[]).slice(0, 5);
  const heroTitle = t("hero.title");
  const highlight = t("hero.highlight");
  const [before, after] = heroTitle.includes(highlight) ? heroTitle.split(highlight) : [heroTitle, ""];

  return (
    <MarketingLayout>
      {/* Hero: one message, one action, then the product itself. */}
      <section className="mx-auto max-w-7xl px-5 pb-16 pt-16 sm:px-8 sm:pt-24 lg:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="m-0 text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground text-balance sm:text-6xl lg:text-7xl">
            {before}
            <span className="relative inline-block whitespace-nowrap">
              {highlight}
              <Underline />
            </span>
            {after}
          </h1>
          <p className="m-0 mx-auto mt-6 max-w-2xl text-lg leading-7 text-mk-ink-80 text-pretty sm:text-xl sm:leading-8">
            {t("hero.subtitle2")}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="h-12 px-6 text-[15px]" asChild>
              <NextLink href="/onboarding">
                {t("hero.primaryButton")}
                <ArrowRight className="size-4" />
              </NextLink>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-6 text-[15px]" asChild>
              <Link href="/features">{t("hero.secondaryButton")}</Link>
            </Button>
          </div>
          {!user && (
            <p className="m-0 mt-5 text-sm text-muted-foreground">
              {t("hero.signInPrompt")}{" "}
              <NextLink href="/login" className="font-medium text-foreground underline underline-offset-4">
                {t("hero.signInLink")}
              </NextLink>
            </p>
          )}
        </div>

        <div className="mx-auto mt-14 max-w-6xl">
          <Screenshot src={`/marketing/${SHOT_VERSION}/dashboard.png`} alt={t("hero.screenshotAlt")} width={1269} height={840} priority />
        </div>
      </section>

      {/* Proof strip: true product facts, one marquee. Platform logos live in the channel wall below. */}
      <section className="border-y border-border bg-card py-12">
        <p className="m-0 text-center text-sm font-medium text-muted-foreground">{t("proof.label")}</p>
        <div className="mk-logo-marquee mt-6 overflow-hidden" aria-label={t("proof.label")}>
          <div className="mk-logo-marquee-track flex w-max">
            {[0, 1].map((setIndex) => (
              <div key={setIndex} className="flex shrink-0 gap-4 pe-4" aria-hidden={setIndex === 1 ? true : undefined}>
                {proof.map((item) => (
                  <div key={`${setIndex}-${item.label}`} className="flex w-[260px] flex-col justify-between rounded-2xl border border-border bg-background p-5">
                    <div>
                      <p className="m-0 text-2xl font-extrabold tracking-tight text-foreground">{item.value}</p>
                      <p className="m-0 mt-1 text-sm leading-5 text-mk-ink-80">{item.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who is it for */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <SectionTitle>{t("whoFor.title")}</SectionTitle>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {whoFor.map((item, i) => (
            <div key={item.title} className={cn("rounded-2xl border border-border p-7", i % 2 === 0 ? "bg-card" : "bg-mk-accent-soft/60")}>
              <h3 className="m-0 text-xl font-bold tracking-tight text-foreground">{item.title}</h3>
              <p className="m-0 mt-3 text-[15px] leading-6 text-mk-ink-80">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature bento with real screenshots */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionTitle>{t("bento.title")}</SectionTitle>
          <div className="mt-14 grid gap-5 lg:grid-cols-12">
            {tiles.map((tile, i) => {
              const image = TILE_IMAGES[tile.id];
              const wide = tile.id === "intelligence";
              return (
                <article
                  key={tile.id}
                  className={cn(
                    "flex flex-col overflow-hidden rounded-2xl border border-border",
                    i % 2 === 0 ? "bg-background" : "bg-mk-accent-soft/50",
                    image.span,
                    wide && "lg:flex-row lg:items-center",
                  )}
                >
                  <div className={cn("p-7 sm:p-8", wide && "lg:w-2/5")}>
                    <Badge variant="accent">{tile.label}</Badge>
                    <h3 className="m-0 mt-4 text-2xl font-bold tracking-tight text-foreground">{tile.title}</h3>
                    <p className="m-0 mt-3 max-w-md text-[15px] leading-6 text-mk-ink-80">{tile.desc}</p>
                  </div>
                  <div className={cn("relative mt-auto ps-7 sm:ps-8", wide ? "lg:w-3/5 lg:ps-0 lg:pe-8 lg:py-8" : "")}>
                    <Screenshot
                      src={image.src}
                      alt={tile.title}
                      width={1245}
                      height={860}
                      className={cn("rounded-tr-none rounded-br-none border-r-0 shadow-lg", wide && "lg:rounded-xl lg:border-r")}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Channel wall: static offset rows, no second marquee */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <SectionTitle sub={t("channelWall.subtitle")}>{t("channelWall.title")}</SectionTitle>
        <div className="mx-auto mt-12 flex max-w-4xl flex-wrap justify-center gap-3 sm:gap-4">
          {CHANNEL_WALL.map((provider) => (
            <div key={provider} className="flex size-24 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card sm:size-28">
              <ChannelGlyph provider={provider} size={56} />
            </div>
          ))}
          {extras.map((extra) => (
            <div key={extra.label} className="flex size-24 items-center justify-center rounded-2xl border border-border bg-mk-accent-soft/60 px-2 text-center text-sm font-semibold text-foreground sm:size-28">
              {extra.label}
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Button variant="outline" asChild>
            <Link href="/channels">{t("channelsPreview.seeAllButton")}</Link>
          </Button>
        </div>
      </section>

      {/* AI agents */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="m-0 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground text-balance sm:text-4xl">
              {t("agentSection.titleLead")} {t("agentSection.titleHighlight")}
            </h2>
            <p className="m-0 mt-4 max-w-xl text-[17px] leading-7 text-mk-ink-80 text-pretty">{t("agentSection.subtitle")}</p>
            <ul className="m-0 mt-8 grid list-none gap-3 p-0">
              {agentBullets.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] leading-6 text-mk-ink-80">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-mk-accent" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/developers/agents">{t("agentSection.primaryButton")}</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/developers/api">{t("agentSection.secondaryButton")}</Link>
              </Button>
            </div>
          </div>
          <CopyBlock code={agentSnippet} label={t("agentSection.codeLabel")} />
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="flex flex-col items-start gap-8 rounded-3xl bg-mk-accent px-8 py-12 text-white sm:px-12 lg:flex-row lg:items-center lg:justify-between lg:py-16">
          <div className="max-w-xl">
            <h2 className="m-0 text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-4xl">{t("ctaBand.title")}</h2>
            <p className="m-0 mt-3 text-[17px] leading-7 text-white/85">{t("ctaBand.subtitle")}</p>
          </div>
          <Button size="lg" className="h-12 shrink-0 bg-white px-6 text-[15px] text-mk-accent hover:bg-white/90" asChild>
            <NextLink href="/onboarding">
              {t("ctaBand.button")}
              <ArrowRight className="size-4" />
            </NextLink>
          </Button>
        </div>
      </section>

      <WallOfLove title={t("wallOfLove.title")} />

      {/* FAQ */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 className="m-0 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground text-balance sm:text-4xl">{t("faq.title")}</h2>
            <Link href="/pricing" className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-medium text-mk-accent underline-offset-4 hover:underline">
              {t("faq.more")}
              <ArrowRight className="size-4" />
            </Link>
          </div>
          <Faq items={faqs} />
        </div>
      </section>
    </MarketingLayout>
  );
}
