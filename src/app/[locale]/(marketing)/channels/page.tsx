"use client";

import { useTranslations } from "next-intl";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import NextLink from "next/link";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

// Brand color swatches are a design token, not translatable content — kept
// out of the message catalog and joined to the translated channel list by name.
const CHANNEL_COLORS: Record<string, string> = {
  Facebook: "#1877F2",
  Instagram: "#E4405F",
  TikTok: "#000000",
  LinkedIn: "#0A66C2",
  Threads: "#111111",
  Pinterest: "#E60023",
  X: "#000000",
};

type Channel = { name: string; category: string; description: string; capabilities: string[]; connection: string };
type Stat = { value: string; label: string; sub: string };
type HowStep = { step: string; title: string; desc: string };

export default function ChannelsPage() {
  const t = useTranslations("channels");
  const channels = t.raw("channels") as Channel[];
  const stats = t.raw("stats") as Stat[];
  const steps = t.raw("howItWorks.steps") as HowStep[];

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

          {/* Stats */}
          <motion.div
            className="mx-auto mt-20 grid max-w-3xl grid-cols-3 gap-px overflow-hidden rounded-xl"
            style={{
              background: "var(--mk-rule)",
              border: "1px solid var(--mk-rule)",
            }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease }}
          >
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="px-5 py-7 text-center bg-card"
              >
                <p
                  className="text-[28px] sm:text-[32px] font-semibold mk-figure text-mk-accent"
                >
                  {stat.value}
                </p>
                <p
                  className="mt-2 text-[12.5px] font-semibold text-foreground"
                >
                  {stat.label}
                </p>
                <p
                  className="mt-0.5 text-[11px] text-muted-foreground"
                >
                  {stat.sub}
                </p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Channel Cards */}
      <section
        className="border-t bg-card border-border"
      >
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="space-y-16">
            {channels.map((channel) => (
              <motion.div
                key={channel.name}
                className="rounded-xl border bg-card overflow-hidden"
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, ease }}
              >
                <div className="grid lg:grid-cols-[1fr_1.2fr]">
                  <div className="p-8 lg:p-12">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: CHANNEL_COLORS[channel.name] }}
                      />
                      <span className="mk-eyebrow">{channel.category}</span>
                    </div>
                    <h3 className="mt-4 text-2xl font-semibold tracking-[-0.03em] leading-[1.1]">
                      {channel.name}
                    </h3>
                    <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                      {channel.description}
                    </p>
                    <div
                      className="mt-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-xs"
                      style={{
                        background: "var(--mk-panel)",
                        border: "1px solid var(--mk-rule)",
                        color: "var(--mk-ink-60)",
                        letterSpacing: "0.12em",
                      }}
                    >
                      {channel.connection}
                    </div>
                  </div>
                  <div
                    className="border-t lg:border-t-0 lg:border-s p-8 lg:p-12 bg-background border-border"
                  >
                    <p className="mk-eyebrow mb-5">{t("capabilitiesLabel")}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {channel.capabilities.map((cap) => (
                        <div key={cap} className="flex items-start gap-2.5">
                          <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                          <p className="text-sm text-muted-foreground">{cap}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mk-eyebrow">{t("howItWorks.eyebrow")}</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-4xl">
              {t("howItWorks.titleLead")} <span className="text-primary">{t("howItWorks.titleHighlight")}</span>
            </h2>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            {steps.map((item) => (
              <div key={item.step} className="text-center">
                <div
                  className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl font-mono text-[15px] font-semibold"
                  style={{
                    background: "var(--mk-accent-soft)",
                    color: "var(--mk-accent)",
                  }}
                >
                  {item.step}
                </div>
                <h3
                  className="mt-5 text-[14px] font-semibold text-foreground"
                >
                  {item.title}
                </h3>
                <p
                  className="mt-2 text-[13px] leading-relaxed text-muted-foreground"
                >
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="border-t bg-foreground border-border"
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
              className="mt-4 text-[14px] sm:text-[15px]"
              style={{
                color: "color-mix(in oklch, var(--mk-paper) 70%, transparent)",
              }}
            >
              {t("cta.subtitle")}
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <NextLink href="/onboarding">
                <Button
                  size="lg"
                  className="h-11 px-7 rounded-lg text-[13.5px] bg-card text-foreground"
                >
                  {t("cta.primaryButton")}
                </Button>
              </NextLink>
              <Link href="/developers/agents">
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
