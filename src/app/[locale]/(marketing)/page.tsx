"use client";

import NextLink from "next/link";
import LocalizedLandingPage from "@/components/marketing/LocalizedLandingPage";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  Zap,
  Building2,
  Users2,
  Camera,
  CheckCircle2,
  Terminal,
} from "lucide-react";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { useOptionalAuth } from "@/components/providers/AuthProvider";
import CopyBlock from "@/components/marketing/CopyBlock";
import Underline from "@/components/marketing/Underline";
import Faq, { type FaqItem } from "@/components/marketing/Faq";
import WallOfLove from "@/components/marketing/WallOfLove";
import { ChannelGlyph } from "@/components/app/ChannelGlyph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import HeroShowcase from "@/components/marketing/HeroShowcase";
import FeatureShowcase from "@/components/marketing/FeatureShowcase";
import CompetitorComparison from "@/components/marketing/CompetitorComparison";
import DayOneBenefits from "@/components/marketing/DayOneBenefits";
import { cn } from "@/lib/utils";

// Deliberately the shortest true version of the integration: discover, then
// schedule. Anything longer stops reading as "this is easy" on a landing page.
// A code artifact, not translatable prose: stays identical across locales.
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

type WhoItem = { title: string; desc: string };

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

function RedesignedLandingPage() {
  const t = useTranslations("home");
  const tPricing = useTranslations("pricing");
  const { user } = useOptionalAuth();
  const whoFor = t.raw("whoFor.items") as WhoItem[];
  const extras = t.raw("channelWall.extras") as { label: string }[];
  const agentBullets = t.raw("agentSection.bullets") as string[];
  const faqs = (tPricing.raw("faqs") as FaqItem[]).slice(0, 5);
  const heroTitle = t("hero.title");
  const highlight = t("hero.highlight");
  const [before, after] = heroTitle.includes(highlight) ? heroTitle.split(highlight) : [heroTitle, ""];

  return (
    <MarketingLayout>
      {/* ─── Hero Section ─── */}
      <section className="relative overflow-hidden px-5 pb-16 pt-12 sm:px-8 sm:pt-20 lg:pb-24">
        {/* Subtle background ambient gradient */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex justify-center overflow-hidden">
          <div className="h-[480px] w-[980px] rounded-full bg-gradient-to-b from-blue-500/10 via-indigo-500/5 to-transparent blur-3xl" />
        </div>

        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-mk-accent/30 bg-mk-accent-soft/80 px-3.5 py-1.5 text-xs font-semibold text-mk-accent">
            <span className="size-1.5 rounded-full bg-mk-accent animate-pulse" />
            Evidence-Led Social Media Automation
          </div>

          <h1 className="m-0 mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground text-balance sm:text-6xl lg:text-7xl">
            {before}
            <span className="relative inline-block whitespace-nowrap text-primary">
              {highlight}
              <Underline />
            </span>
            {after}
          </h1>

          <p className="m-0 mx-auto mt-6 max-w-2xl text-lg leading-7 text-mk-ink-80 text-pretty sm:text-xl sm:leading-8">
            {t("hero.subtitle2")}
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="h-12 px-7 text-[15px] font-semibold shadow-lg shadow-blue-500/20" asChild>
              <NextLink href="/onboarding">
                {t("hero.primaryButton")}
                <ArrowRight className="size-4" />
              </NextLink>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-7 text-[15px] font-semibold" asChild>
              <Link href="/features">{t("hero.secondaryButton")}</Link>
            </Button>
          </div>

          {!user && (
            <p className="m-0 mt-5 text-xs text-muted-foreground">
              {t("hero.signInPrompt")}{" "}
              <NextLink href="/login" className="font-semibold text-foreground underline underline-offset-4">
                {t("hero.signInLink")}
              </NextLink>
              <span className="mx-2 text-muted-foreground/60">·</span>
              <span>7-day free trial on paid plans</span>
            </p>
          )}
        </div>

        {/* Live Interactive Command Center (Zero Screenshots) */}
        <HeroShowcase />
      </section>

      {/* ─── What You Get on Day One ─── */}
      <DayOneBenefits />

      {/* ─── Interactive Feature Deep Dive (Zero Screenshots) ─── */}
      <FeatureShowcase />

      {/* ─── Competitor Comparison Matrix ─── */}
      <CompetitorComparison />

      {/* ─── Who Is It For ─── */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <SectionTitle sub="Whether managing multiple clients or scaling your own brand, Markaestro keeps publishing organized.">
          {t("whoFor.title")}
        </SectionTitle>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {whoFor.map((item, i) => (
            <div
              key={item.title}
              className="flex flex-col justify-between rounded-2xl border border-border bg-card p-7 transition-all hover:shadow-lg hover:border-mk-accent/30"
            >
              <div>
                <div className="grid size-11 place-items-center rounded-xl bg-mk-accent-soft text-mk-accent">
                  {i === 0 && <Zap className="size-5" />}
                  {i === 1 && <Building2 className="size-5" />}
                  {i === 2 && <Users2 className="size-5" />}
                  {i === 3 && <Camera className="size-5" />}
                </div>
                <h3 className="m-0 mt-5 text-xl font-bold tracking-tight text-foreground">{item.title}</h3>
                <p className="m-0 mt-3 text-sm leading-6 text-mk-ink-80">{item.desc}</p>
              </div>
              <div className="mt-6 pt-4 border-t border-border/60">
                <span className="text-xs font-semibold text-mk-accent flex items-center gap-1">
                  Explore workflow <ArrowRight className="size-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Channel Wall ─── */}
      <section className="border-t border-border bg-card/40 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionTitle sub={t("channelWall.subtitle")}>{t("channelWall.title")}</SectionTitle>
          <div className="mx-auto mt-12 flex max-w-4xl flex-wrap justify-center gap-3 sm:gap-4">
            {CHANNEL_WALL.map((provider) => (
              <div
                key={provider}
                className="group flex size-24 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-background transition-all hover:scale-105 hover:shadow-md sm:size-28"
              >
                <ChannelGlyph provider={provider} size={48} />
                <span className="text-[11px] font-semibold capitalize text-muted-foreground group-hover:text-foreground">
                  {provider === "meta" ? "Facebook" : provider}
                </span>
              </div>
            ))}
            {extras.map((extra) => (
              <div
                key={extra.label}
                className="flex size-24 flex-col items-center justify-center gap-1.5 rounded-2xl border border-mk-accent/30 bg-mk-accent-soft px-2 text-center text-xs font-bold text-mk-accent sm:size-28"
              >
                <Terminal className="size-4" />
                <span>{extra.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Button variant="outline" asChild>
              <Link href="/channels">{t("channelsPreview.seeAllButton")}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ─── AI Agents & Developer Integration ─── */}
      <section className="border-t border-border bg-background py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-mk-accent/30 bg-mk-accent-soft px-3 py-1 text-xs font-bold text-mk-accent">
              <Terminal className="size-3.5" />
              <span>Model Context Protocol & Connect API</span>
            </div>
            <h2 className="m-0 mt-4 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground text-balance sm:text-4xl">
              {t("agentSection.titleLead")} {t("agentSection.titleHighlight")}
            </h2>
            <p className="m-0 mt-4 max-w-xl text-[16px] leading-7 text-mk-ink-80 text-pretty">
              {t("agentSection.subtitle")}
            </p>
            <ul className="m-0 mt-8 grid list-none gap-3.5 p-0">
              {agentBullets.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-mk-ink-80">
                  <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                  <span>{item}</span>
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
          <div className="rounded-2xl border border-border shadow-lg">
            <CopyBlock code={agentSnippet} label={t("agentSection.codeLabel")} />
          </div>
        </div>
      </section>

      {/* ─── High-Converting CTA Band ─── */}
      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 px-8 py-12 text-white shadow-xl sm:px-12 lg:flex lg:items-center lg:justify-between lg:py-16">
          {/* Subtle glow circles */}
          <div className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-white/10 blur-2xl" />

          <div className="relative z-10 max-w-xl">
            <h2 className="m-0 text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-4xl">
              {t("ctaBand.title")}
            </h2>
            <p className="m-0 mt-3 text-base leading-relaxed text-white/90">
              {t("ctaBand.subtitle")}
            </p>
            <div className="mt-4 flex items-center gap-4 text-xs text-white/80">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-white" /> Guided setup
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-white" /> Card required for trial
              </span>
            </div>
          </div>

          <div className="relative z-10 mt-8 shrink-0 lg:mt-0">
            <Button
              size="lg"
              className="h-13 bg-white px-8 text-[15px] font-bold text-blue-700 hover:bg-white/90 shadow-md"
              asChild
            >
              <NextLink href="/onboarding">
                {t("ctaBand.button")}
                <ArrowRight className="size-4" />
              </NextLink>
            </Button>
          </div>
        </div>
      </section>

      {/* Wall of Love (Renders if testimonials exist) */}
      <WallOfLove title={t("wallOfLove.title")} />

      {/* ─── FAQ Section ─── */}
      <section className="border-t border-border bg-card/50">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1fr_2fr]">
          <div>
            <Badge variant="outline" className="mb-3 text-xs font-semibold">
              FAQ
            </Badge>
            <h2 className="m-0 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground text-balance sm:text-4xl">
              {t("faq.title")}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Everything you need to know about plans, channels, and intelligent recycling.
            </p>
            <Link
              href="/pricing"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-mk-accent underline-offset-4 hover:underline"
            >
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

// Preserve translated pages until the new English showcase copy is localized.
export default function LandingPage() {
  const locale = useLocale();
  return locale === "en" ? <RedesignedLandingPage /> : <LocalizedLandingPage />;
}
