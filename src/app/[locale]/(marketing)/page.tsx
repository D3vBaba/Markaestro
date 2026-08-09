"use client";

import NextLink from "next/link";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import MarketingLayout from "@/components/layout/MarketingLayout";
import CopyBlock from "@/components/marketing/CopyBlock";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

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

type Stat = { value: string; label: string; sub?: string };
type FeatureItem = { title: string; desc: string };
type ChannelItem = { name: string; desc: string };
type ComposerRow = { label: string; value: string };

export default function LandingPage() {
  const t = useTranslations("home");
  const heroStats = t.raw("hero.stats") as Stat[];
  const featureItems = t.raw("featuresPreview.items") as FeatureItem[];
  const channelItems = t.raw("channelsPreview.channels") as ChannelItem[];
  const channelStats = t.raw("channelsPreview.stats") as Stat[];
  const composerRows = t.raw("composerPreview.rows") as ComposerRow[];
  const composerBullets = t.raw("composerPreview.bullets") as string[];
  const agentBullets = t.raw("agentSection.bullets") as string[];

  return (
    <MarketingLayout>
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28 lg:py-36">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <div
              className="mb-7 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[10.5px] uppercase"
              style={{
                border: "1px solid color-mix(in oklch, var(--mk-accent) 24%, var(--mk-rule))",
                background: "var(--mk-accent-soft)",
                color: "var(--mk-accent)",
                letterSpacing: "0.14em",
              }}
            >
              {t("hero.badge")}
            </div>
            <h1
              className="text-[40px] sm:text-[56px] lg:text-[72px] font-semibold leading-[1.05]"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.035em" }}
            >
              {t("hero.titleLead")}{" "}
              <span style={{ color: "var(--mk-accent)" }}>{t("hero.titleHighlight")}</span>
            </h1>
            <p
              className="mt-6 text-[15px] sm:text-[17px] lg:text-[18px] leading-relaxed max-w-2xl mx-auto"
              style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
            >
              {t("hero.subtitle")}
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <NextLink href="/onboarding">
                <Button size="lg" className="h-11 px-7 rounded-lg text-[13.5px]">
                  {t("hero.primaryButton")}
                </Button>
              </NextLink>
              <Link href="/features">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                >
                  {t("hero.secondaryButton")}
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Hero stats */}
          <motion.div
            className="mx-auto mt-20 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-xl"
            style={{
              background: "var(--mk-rule)",
              border: "1px solid var(--mk-rule)",
            }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease }}
          >
            {heroStats.map((stat) => (
              <div
                key={stat.label}
                className="px-5 py-7 text-center"
                style={{ background: "var(--mk-paper)" }}
              >
                <p
                  className="text-[28px] sm:text-[32px] font-semibold mk-figure"
                  style={{ color: "var(--mk-accent)", letterSpacing: "-0.03em" }}
                >
                  {stat.value}
                </p>
                <p className="mt-2 mk-eyebrow">{stat.label}</p>
              </div>
            ))}
          </motion.div>

          {/* Social proof. Deliberately no company names or logos — we don't
              put a brand here until it's a real customer who agreed to it. */}
          <motion.div
            className="mx-auto mt-14 max-w-3xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.6, ease }}
          >
            <p
              className="text-center mk-eyebrow"
              style={{ letterSpacing: "0.2em" }}
            >
              {t("hero.trustedBy")}
            </p>
          </motion.div>
        </div>
      </section>

      {/* ─── Features Preview ─── */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--mk-rule)",
          background: "var(--mk-paper)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mk-eyebrow">{t("featuresPreview.eyebrow")}</p>
            <h2
              className="mt-3 text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
            >
              {t("featuresPreview.titleLead")}{" "}
              <span style={{ color: "var(--mk-accent)" }}>{t("featuresPreview.titleHighlight")}</span>
            </h2>
            <p
              className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
              style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
            >
              {t("featuresPreview.subtitle")}
            </p>
          </div>

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featureItems.map(({ title, desc }) => (
              <div
                key={title}
                className="rounded-xl p-6"
                style={{
                  background: "var(--mk-paper)",
                  border: "1px solid var(--mk-rule)",
                }}
              >
                <h3
                  className="text-[14px] font-semibold"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
                >
                  {title}
                </h3>
                <p
                  className="mt-2.5 text-[13px] leading-relaxed"
                  style={{ color: "var(--mk-ink-60)" }}
                >
                  {desc}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link href="/features">
              <Button variant="outline" className="rounded-lg h-9 text-[13px]">
                {t("featuresPreview.exploreButton")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Channels Preview ─── */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--mk-rule)",
          background: "var(--mk-surface)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mk-eyebrow">{t("channelsPreview.eyebrow")}</p>
              <h2
                className="mt-3 text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
                style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
              >
                {t("channelsPreview.titleLead")}{" "}
                <span style={{ color: "var(--mk-accent)" }}>{t("channelsPreview.titleHighlight")}</span>
              </h2>
              <p
                className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
                style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
              >
                {t("channelsPreview.subtitle")}
              </p>
              <div className="mt-8 flex flex-col gap-4">
                {channelItems.map((ch) => (
                  <div key={ch.name} className="flex items-start gap-3">
                    <div
                      className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "var(--mk-accent)" }}
                    />
                    <div>
                      <p
                        className="text-[13.5px] font-semibold"
                        style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                      >
                        {ch.name}
                      </p>
                      <p
                        className="text-[13px] mt-0.5"
                        style={{ color: "var(--mk-ink-60)" }}
                      >
                        {ch.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link href="/channels">
                  <Button variant="outline" className="rounded-lg h-9 text-[13px]">
                    {t("channelsPreview.seeAllButton")}
                  </Button>
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {channelStats.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl p-6"
                  style={{
                    background: "var(--mk-paper)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
                  <p
                    className="text-[36px] font-semibold mk-figure"
                    style={{ color: "var(--mk-accent)", letterSpacing: "-0.035em" }}
                  >
                    {item.value}
                  </p>
                  <p
                    className="mt-2 text-[12.5px] font-semibold"
                    style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                  >
                    {item.label}
                  </p>
                  <p
                    className="mt-0.5 text-[11.5px]"
                    style={{ color: "var(--mk-ink-60)" }}
                  >
                    {item.sub}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Composer Preview ─── */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--mk-rule)",
          background: "var(--mk-paper)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <div className="order-2 lg:order-1">
              <div
                className="rounded-xl p-6"
                style={{
                  background: "var(--mk-surface)",
                  border: "1px solid var(--mk-rule)",
                }}
              >
                <div className="flex items-center gap-2 mk-eyebrow">
                  <span
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ background: "var(--mk-accent)" }}
                  />
                  {t("composerPreview.panelLabel")}
                </div>
                <div className="mt-5 flex flex-col gap-2.5 font-mono text-[12px]">
                  {composerRows.map((row) => (
                    <div
                      key={row.label}
                      className="rounded-lg px-3.5 py-3"
                      style={{
                        background: "var(--mk-paper)",
                        border: "1px solid var(--mk-rule)",
                      }}
                    >
                      <span
                        className="font-semibold"
                        style={{ color: "var(--mk-ink)" }}
                      >
                        {row.label}:
                      </span>{" "}
                      <span style={{ color: "var(--mk-ink-60)" }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <p className="mk-eyebrow">{t("composerPreview.eyebrow")}</p>
              <h2
                className="mt-3 text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
                style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
              >
                {t("composerPreview.titleLead")}{" "}
                <span style={{ color: "var(--mk-accent)" }}>{t("composerPreview.titleHighlight")}</span>
              </h2>
              <p
                className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
                style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
              >
                {t("composerPreview.subtitle")}
              </p>
              <div className="mt-8 flex flex-col gap-4">
                {composerBullets.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <div
                      className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "var(--mk-accent)" }}
                    />
                    <p
                      className="text-[13.5px]"
                      style={{ color: "var(--mk-ink-80)", letterSpacing: "-0.005em" }}
                    >
                      {item}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link href="/features">
                  <Button variant="outline" className="rounded-lg h-9 text-[13px]">
                    {t("composerPreview.seeFeaturesButton")}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── AI Agents ─── */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--mk-rule)",
          background: "var(--mk-surface)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mk-eyebrow">{t("agentSection.eyebrow")}</p>
              <h2
                className="mt-3 text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
                style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
              >
                {t("agentSection.titleLead")}{" "}
                <span style={{ color: "var(--mk-accent)" }}>{t("agentSection.titleHighlight")}</span>
              </h2>
              <p
                className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
                style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
              >
                {t("agentSection.subtitle")}
              </p>
              <div className="mt-8 flex flex-col gap-4">
                {agentBullets.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <div
                      className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "var(--mk-accent)" }}
                    />
                    <p
                      className="text-[13.5px]"
                      style={{ color: "var(--mk-ink-80)", letterSpacing: "-0.005em" }}
                    >
                      {item}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/developers/agents">
                  <Button className="rounded-lg h-9 text-[13px]">
                    {t("agentSection.primaryButton")}
                  </Button>
                </Link>
                <Link href="/developers/api">
                  <Button variant="outline" className="rounded-lg h-9 text-[13px]">
                    {t("agentSection.secondaryButton")}
                  </Button>
                </Link>
              </div>
            </div>

            <CopyBlock code={agentSnippet} label={t("agentSection.codeLabel")} />
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--mk-rule)",
          background: "var(--mk-ink)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p
              className="mk-eyebrow"
              style={{ color: "color-mix(in oklch, var(--mk-paper) 50%, transparent)" }}
            >
              {t("cta.eyebrow")}
            </p>
            <h2
              className="mt-3 text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
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
                  style={{
                    background: "var(--mk-paper)",
                    color: "var(--mk-ink)",
                  }}
                >
                  {t("cta.primaryButton")}
                </Button>
              </NextLink>
              <Link href="/contact">
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{
                    color: "color-mix(in oklch, var(--mk-paper) 80%, transparent)",
                  }}
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
