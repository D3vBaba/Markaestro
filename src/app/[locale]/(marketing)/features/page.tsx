"use client";

import { useTranslations } from "next-intl";
import MarketingLayout from "@/components/layout/MarketingLayout";
import CopyBlock from "@/components/marketing/CopyBlock";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import NextLink from "next/link";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

type CoreFeature = {
  title: string;
  description: string;
  details: string[];
  codeLabel?: string;
  agentGuideLink?: string;
};
type PlatformFeature = { title: string; description: string };
type IntelligenceBlock = { title: string; body: string };

// The curl sample is a code artifact, not translatable prose — kept out of
// the message catalog, same reasoning as CopyBlock samples on every other page.
const AGENT_API_CODE = `curl -X POST "$MARKAESTRO_URL/api/connect/v1/posts" \\
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "caption": "Cold brew season starts Friday.",
    "media": ["ast_777"],
    "social_accounts": ["prod_123#instagram:instagram:ig_123"],
    "is_draft": false,
    "scheduled_at": "2026-08-14T15:00:00.000Z"
  }'`;

export default function FeaturesPage() {
  const t = useTranslations("features");
  const coreFeatures = t.raw("coreFeatures") as CoreFeature[];
  const platformFeatures = t.raw("platformFeatures") as PlatformFeature[];
  const intelligenceLoop = t.raw("intelligence.loop") as IntelligenceBlock[];
  const intelligenceTabs = t.raw("intelligence.tabs") as IntelligenceBlock[];
  const intelligencePrinciples = t.raw("intelligence.principles") as string[];

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <p className="mk-eyebrow">{t("hero.eyebrow")}</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] leading-[1.05] lg:text-6xl">
              {t("hero.titleLead")} <span className="text-primary">{t("hero.titleHighlight")}</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              {t("hero.subtitle")}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Core Features */}
      <section className="border-t" style={{ background: "var(--mk-paper)", borderColor: "var(--mk-rule)" }}>
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="space-y-24">
            {coreFeatures.map((feature, i) => (
              <motion.div
                key={feature.title}
                className={`grid gap-12 lg:gap-20 lg:grid-cols-2 lg:items-center ${i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""}`}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.5, ease }}
              >
                <div>
                  <div
                    className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[10.5px] uppercase"
                    style={{
                      border: "1px solid color-mix(in oklch, var(--mk-accent) 24%, var(--mk-rule))",
                      background: "var(--mk-accent-soft)",
                      color: "var(--mk-accent)",
                      letterSpacing: "0.14em",
                    }}
                  >
                    {feature.title}
                  </div>
                  <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-3xl">
                    {feature.title}
                  </h2>
                  <p className="mt-4 text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                  <ul className="mt-8 space-y-3">
                    {feature.details.map((detail) => (
                      <li key={detail} className="flex items-start gap-3">
                        <div className="mt-2 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        <p className="text-sm text-muted-foreground">{detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  className="rounded-xl p-6 sm:p-10 lg:p-14"
                  style={{
                    background: "var(--mk-surface)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
                  {feature.codeLabel ? (
                    <>
                      <CopyBlock code={AGENT_API_CODE} label={feature.codeLabel} />
                      <Link
                        href="/developers/agents"
                        className="mt-4 inline-block text-sm text-primary hover:underline"
                      >
                        {feature.agentGuideLink}
                      </Link>
                    </>
                  ) : (
                    <div className="flex items-center justify-center">
                      <div
                        className="rounded-xl p-7"
                        style={{ background: "var(--mk-accent-soft)" }}
                      >
                        <p
                          className="text-[16px] font-semibold"
                          style={{ color: "var(--mk-accent)", letterSpacing: "-0.01em" }}
                        >
                          {feature.title}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Intelligence */}
      <section id="intelligence" className="scroll-mt-24 border-t" style={{ borderColor: "var(--mk-rule)", background: "var(--mk-surface)" }}>
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mk-eyebrow">{t("intelligence.eyebrow")}</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-4xl">
              {t("intelligence.titleLead")} <span className="text-primary">{t("intelligence.titleHighlight")}</span>
            </h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">{t("intelligence.subtitle")}</p>
          </div>

          <h3 className="mt-16 text-center text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("intelligence.loopTitle")}
          </h3>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {intelligenceLoop.map((step, index) => (
              <motion.li
                key={step.title}
                className="rounded-xl p-6"
                style={{ background: "var(--mk-paper)", border: "1px solid var(--mk-rule)" }}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.4, ease, delay: index * 0.06 }}
              >
                <div
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-[12px] font-semibold"
                  style={{ background: "var(--mk-accent-soft)", color: "var(--mk-accent)" }}
                >
                  {index + 1}
                </div>
                <h4 className="mt-4 text-[15px] font-semibold text-foreground">{step.title}</h4>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </motion.li>
            ))}
          </ol>

          <h3 className="mt-20 text-center text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("intelligence.tabsTitle")}
          </h3>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {intelligenceTabs.map((tab) => (
              <div key={tab.title} className="rounded-xl border bg-card p-6">
                <h4 className="text-sm font-semibold text-foreground">{tab.title}</h4>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{tab.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-start">
            <div className="rounded-xl p-8" style={{ background: "var(--mk-paper)", border: "1px solid var(--mk-rule)" }}>
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("intelligence.principlesTitle")}</h3>
              <ul className="mt-5 space-y-3">
                {intelligencePrinciples.map((principle) => (
                  <li key={principle} className="flex items-start gap-3">
                    <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <p className="text-sm leading-relaxed text-muted-foreground">{principle}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl p-8" style={{ background: "var(--mk-accent-soft)", border: "1px solid color-mix(in oklch, var(--mk-accent) 24%, var(--mk-rule))" }}>
              <p className="text-sm leading-relaxed" style={{ color: "var(--mk-ink)" }}>{t("intelligence.plans")}</p>
              <NextLink href="/onboarding" className="mt-6 inline-block">
                <Button className="h-10 rounded-lg px-5 text-[13px]">{t("intelligence.cta")}</Button>
              </NextLink>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Features */}
      <section className="border-t">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mk-eyebrow">{t("platformSection.eyebrow")}</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-4xl">
              {t("platformSection.titleLead")} <span className="text-primary">{t("platformSection.titleHighlight")}</span>
            </h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              {t("platformSection.subtitle")}
            </p>
          </div>
          <div className="mt-16 grid gap-6 sm:grid-cols-3">
            {platformFeatures.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border bg-card p-6 transition-colors"
              >
                <h3 className="text-sm font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="border-t"
        style={{ background: "var(--mk-ink)", borderColor: "var(--mk-rule)" }}
      >
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
              <Link href="/contact">
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
