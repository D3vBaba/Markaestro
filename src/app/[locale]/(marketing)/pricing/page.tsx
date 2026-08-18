"use client";

import { useTranslations } from "next-intl";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { ChevronDown, Check } from "lucide-react";
import { Link } from "@/i18n/navigation";
import NextLink from "next/link";
import { motion } from "framer-motion";
import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { PLANS, PLAN_TIERS, COMPARISON_CATEGORIES, TRIAL_DAYS } from "@/lib/stripe/plans";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

type Faq = { q: string; a: string };
type ComparisonCategoryLabels = { name: string; features: { name: string }[] };

export default function PricingPage() {
  const t = useTranslations("pricing");
  const [annual, setAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const faqs = t.raw("faqs") as Faq[];
  // Translated labels only — the actual per-plan values (true/false/"5"/
  // "Unlimited") stay sourced from plans.ts, the single source of truth also
  // used by billing logic elsewhere. Zipped back together by index below;
  // categories/features are a stable, code-controlled ordering on both sides.
  const comparisonLabels = t.raw("comparison.categories") as ComparisonCategoryLabels[];

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
              {t("hero.titleLead")}{" "}
              <span className="text-primary">{t("hero.titleHighlight")}</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              {t("hero.subtitle", { trialDays: TRIAL_DAYS })}
            </p>

            {/* Billing toggle */}
            <div className="mt-10 inline-flex items-center gap-3 rounded-full border bg-muted/30 p-1.5">
              <button
                className={cn(
                  "rounded-full px-5 py-2 text-sm font-medium transition-all",
                  !annual ? "bg-mk-ink text-mk-paper" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setAnnual(false)}
              >
                {t("hero.monthlyToggle")}
              </button>
              <button
                className={cn(
                  "rounded-full px-5 py-2 text-sm font-medium transition-all",
                  annual ? "bg-mk-ink text-mk-paper" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setAnnual(true)}
              >
                {t("hero.annualToggle")}{" "}
                <span className="ms-1 rounded-full bg-mk-accent-soft text-mk-accent px-2 py-0.5 text-[10px] font-bold">
                  {t("hero.annualSaveBadge")}
                </span>
              </button>
            </div>

            <motion.p
              className="mt-4 text-sm text-mk-pos font-medium"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {t("hero.trialLine", { trialDays: TRIAL_DAYS, trialEndDay: TRIAL_DAYS + 1 })}
              {annual && t("hero.annualSavingsSuffix")}
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="border-t" style={{ background: "var(--mk-paper)", borderColor: "var(--mk-rule)" }}>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {/* Free tier — rendered explicitly: PLAN_TIERS deliberately only
                lists the purchasable tiers, and the Free card is the on-ramp,
                not a recommendation (Pro keeps the highlight). */}
            <motion.div
              className="rounded-xl border border-border/40 bg-card p-7 flex flex-col"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, ease }}
            >
              <div>
                <h3 className="text-lg font-semibold">{t("planNames.free")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("plans.free.description")}</p>
              </div>
              <div className="mt-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight">$0</span>
                  <span className="text-sm text-muted-foreground">{t("planCard.perMonth")}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t("planCard.freeForever")}</p>
              </div>
              <NextLink href="/onboarding" className="mt-6 block">
                <Button variant="outline" className="w-full rounded-lg h-11 text-[13.5px]">
                  {t("planCard.startFreeButton")}
                </Button>
              </NextLink>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {t("planCard.noCardLine")}
              </p>
              <div className="mt-8 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">{t("planCard.everythingIncluded")}</p>
                <ul className="space-y-3">
                  {(t.raw("plans.free.features") as string[]).map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
            {PLAN_TIERS.map((tierKey, i) => {
              const tier = PLANS[tierKey];
              const price = annual ? tier.price.annual : tier.price.monthly;
              const monthlyPrice = tier.price.monthly;
              const dailyCost = annual ? (tier.price.annual / 30).toFixed(2) : null;
              const planName = t(`planNames.${tierKey}`);
              const features = t.raw(`plans.${tierKey}.features`) as string[];
              const description = t(`plans.${tierKey}.description`);

              return (
                <motion.div
                  key={tierKey}
                  className={cn(
                    "rounded-xl border bg-card p-7 flex flex-col",
                    tier.highlighted
                      ? "border-primary shadow-lg ring-1 ring-primary/20 relative"
                      : "border-border/40"
                  )}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: (i + 1) * 0.08, duration: 0.4, ease }}
                >
                  {tier.highlighted && tier.badge && (
                    <div className="absolute -top-3 start-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-primary px-4 py-1 text-xs font-semibold text-white">
                        {t("mostPopularBadge")}
                      </span>
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold">{planName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                  </div>
                  <div className="mt-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold tracking-tight">
                        ${price}
                      </span>
                      <span className="text-sm text-muted-foreground">{t("planCard.perMonth")}</span>
                    </div>
                    {annual && (
                      <div className="mt-1.5 space-y-0.5">
                        <p className="text-xs text-muted-foreground">
                          <span className="line-through text-muted-foreground/50">${monthlyPrice}{t("planCard.perMonth")}</span>
                          {" "}{t("planCard.billedAnnually", { annualTotal: price * 12 })}
                        </p>
                        {dailyCost && (
                          <p className="text-xs text-mk-pos font-medium">
                            {t("planCard.justPerDay", { dailyCost })}
                          </p>
                        )}
                      </div>
                    )}
                    {!annual && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("planCard.billedMonthly")}
                      </p>
                    )}
                  </div>
                  <NextLink href="/onboarding" className="mt-6 block">
                    <Button
                      variant={tier.highlighted ? "default" : "outline"}
                      className={cn(
                        "w-full rounded-lg h-11 text-[13.5px]",
                        tier.highlighted && "bg-primary hover:bg-primary/90"
                      )}
                    >
                      {t("planCard.startTrialButton", { trialDays: TRIAL_DAYS })}
                    </Button>
                  </NextLink>
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">
                    {t("planCard.noChargeLine", { trialDays: TRIAL_DAYS })}
                  </p>
                  <div className="mt-8 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">{t("planCard.everythingIncluded")}</p>
                    <ul className="space-y-3">
                      {features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5">
                          <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span className="text-sm text-muted-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="border-t">
        <div className="mx-auto max-w-5xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-3xl">
              {t("comparison.titleLead")} <span className="text-primary">{t("comparison.titleHighlight")}</span>
            </h2>
            <p className="mt-4 text-muted-foreground">
              {t("comparison.subtitle")}
            </p>
            {/* The comparison values come from plans.ts and cover the paid
                tiers only — the Free plan is summarized in one line instead
                of a fourth column. */}
            <p className="mt-3 text-sm text-muted-foreground/80">
              {t("comparison.freeNote")}
            </p>
          </div>

          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-4 text-start font-medium text-muted-foreground w-[200px]" />
                  <th className="py-4 text-center font-semibold w-[120px]">{t("planNames.starter")}</th>
                  <th className="py-4 text-center font-semibold w-[120px]">
                    <span className="text-primary">{t("planNames.pro")}</span>
                  </th>
                  <th className="py-4 text-center font-semibold w-[120px]">{t("planNames.business")}</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_CATEGORIES.map((cat, catIndex) => (
                  <Fragment key={cat.name}>
                    <tr>
                      <td colSpan={4} className="pt-8 pb-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-foreground">{comparisonLabels[catIndex].name}</p>
                      </td>
                    </tr>
                    {cat.features.map((feature, featureIndex) => (
                      <tr key={feature.name} className="border-b border-border/40">
                        <td className="py-3 text-muted-foreground">{comparisonLabels[catIndex].features[featureIndex].name}</td>
                        {(["starter", "pro", "business"] as const).map((plan) => (
                          <td key={plan} className="py-3 text-center">
                            {typeof feature[plan] === "boolean" ? (
                              feature[plan] ? (
                                <Check className="h-4 w-4 text-primary mx-auto" />
                              ) : (
                                <span className="text-muted-foreground/30">—</span>
                              )
                            ) : (
                              <span className={cn("text-sm", plan === "pro" ? "font-medium text-primary" : "text-muted-foreground")}>
                                {feature[plan]}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t" style={{ background: "var(--mk-surface)", borderColor: "var(--mk-rule)" }}>
        <div className="mx-auto max-w-3xl px-6 py-24 lg:py-32">
          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-3xl">
              {t("faqTitleLead")} <span className="text-primary">{t("faqTitleHighlight")}</span>
            </h2>
          </div>
          <div className="mt-12 space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="rounded-xl border bg-card overflow-hidden"
              >
                <button
                  className="flex w-full items-center justify-between p-6 text-start"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-sm font-medium text-foreground pe-4">{faq.q}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                      openFaq === i && "rotate-180"
                    )}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-6 pt-0">
                    <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-mk-ink text-mk-paper">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-4xl">
              {t("cta.title", { trialDays: TRIAL_DAYS })}
            </h2>
            <p className="mt-5 text-mk-paper/70">
              {t("cta.subtitle", { trialEndDay: TRIAL_DAYS + 1 })}
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <NextLink href="/onboarding">
                <Button size="lg" variant="secondary" className="h-11 px-7 rounded-lg text-[13.5px] bg-mk-paper text-mk-ink hover:bg-mk-paper/90">
                  {t("cta.primaryButton")}
                </Button>
              </NextLink>
              <Link href="/contact">
                <Button size="lg" variant="ghost" className="h-11 px-7 rounded-lg text-[13.5px] text-mk-paper/80 hover:text-mk-paper hover:bg-mk-paper/10">
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
