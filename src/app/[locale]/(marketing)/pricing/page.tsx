"use client";

import { useTranslations } from "next-intl";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { Check, Minus } from "lucide-react";
import Faq from "@/components/marketing/Faq";
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
        <div className="mx-auto max-w-7xl px-5 pb-12 pt-16 sm:px-8 sm:pt-24">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <h1 className="m-0 text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground text-balance lg:text-6xl">
              {t("hero.titleLead")} {t("hero.titleHighlight")}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-7 text-mk-ink-80 text-pretty">
              {t("hero.subtitle", { trialDays: TRIAL_DAYS })}
            </p>

            {/* Billing toggle */}
            <div className="mt-10 inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
              <button
                className={cn(
                  "h-9 rounded-md px-4 text-sm font-medium transition-colors",
                  !annual ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_var(--mk-rule)]" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setAnnual(false)}
              >
                {t("hero.monthlyToggle")}
              </button>
              <button
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors",
                  annual ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_var(--mk-rule)]" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setAnnual(true)}
              >
                {t("hero.annualToggle")}
                <span className="rounded-md bg-mk-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-mk-accent">
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
      <section>
        <div className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {/* Free tier — rendered explicitly: PLAN_TIERS deliberately only
                lists the purchasable tiers, and the Free card is the on-ramp,
                not a recommendation (Pro keeps the highlight). */}
            <motion.div
              className="flex flex-col rounded-2xl border border-border bg-card p-7"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, ease }}
            >
              <div>
                <h3 className="m-0 text-lg font-bold text-foreground">{t("planNames.free")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("plans.free.description")}</p>
              </div>
              <div className="mt-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground">$0</span>
                  <span className="text-sm text-muted-foreground">{t("planCard.perMonth")}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t("planCard.freeForever")}</p>
              </div>
              <NextLink href="/onboarding" className="mt-6 block">
                <Button variant="outline" size="lg" className="w-full">
                  {t("planCard.startFreeButton")}
                </Button>
              </NextLink>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {t("planCard.noCardLine")}
              </p>
              <div className="mt-8 flex-1">
                <p className="mb-4 text-xs font-medium text-muted-foreground">{t("planCard.everythingIncluded")}</p>
                <ul className="space-y-3">
                  {(t.raw("plans.free.features") as string[]).map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-mk-accent" />
                      <span className="text-sm text-mk-ink-80">{feature}</span>
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
                    "relative flex flex-col rounded-2xl border p-7",
                    tier.highlighted
                      ? "border-mk-accent bg-mk-accent-soft/60 shadow-xl shadow-mk-accent/10"
                      : "border-border bg-card"
                  )}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: (i + 1) * 0.08, duration: 0.4, ease }}
                >
                  {tier.highlighted && tier.badge && (
                    <div className="absolute -top-3 start-6">
                      <span className="rounded-md bg-mk-accent px-2.5 py-1 text-xs font-semibold text-white">
                        {t("mostPopularBadge")}
                      </span>
                    </div>
                  )}
                  <div>
                    <h3 className="m-0 text-lg font-bold text-foreground">{planName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                  </div>
                  <div className="mt-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold tracking-tight text-foreground">
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
                      size="lg"
                      className="w-full"
                    >
                      {t("planCard.startTrialButton", { trialDays: TRIAL_DAYS })}
                    </Button>
                  </NextLink>
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">
                    {t("planCard.noChargeLine", { trialDays: TRIAL_DAYS })}
                  </p>
                  <div className="mt-8 flex-1">
                    <p className="mb-4 text-xs font-medium text-muted-foreground">{t("planCard.everythingIncluded")}</p>
                    <ul className="space-y-3">
                      {features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5">
                          <Check className="mt-0.5 size-4 shrink-0 text-mk-accent" />
                          <span className="text-sm text-mk-ink-80">{feature}</span>
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
            <h2 className="m-0 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground text-balance lg:text-4xl">
              {t("comparison.titleLead")} {t("comparison.titleHighlight")}
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
                    <span className="text-mk-accent">{t("planNames.pro")}</span>
                  </th>
                  <th className="py-4 text-center font-semibold w-[120px]">{t("planNames.business")}</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_CATEGORIES.map((cat, catIndex) => (
                  <Fragment key={cat.name}>
                    <tr>
                      <td colSpan={4} className="pt-8 pb-3">
                        {/* Labels pair with COMPARISON_CATEGORIES by index; fall back to the
                            English name from plans.ts when a row lands before its translation. */}
                        <p className="text-xs font-medium text-foreground">{comparisonLabels[catIndex]?.name ?? cat.name}</p>
                      </td>
                    </tr>
                    {cat.features.map((feature, featureIndex) => (
                      <tr key={feature.name} className="border-b border-border/40">
                        <td className="py-3 text-muted-foreground">{comparisonLabels[catIndex]?.features?.[featureIndex]?.name ?? feature.name}</td>
                        {(["starter", "pro", "business"] as const).map((plan) => (
                          <td key={plan} className="py-3 text-center">
                            {typeof feature[plan] === "boolean" ? (
                              feature[plan] ? (
                                <Check className="mx-auto size-4 text-mk-accent" />
                              ) : (
                                <Minus className="mx-auto size-4 text-mk-ink-20" aria-hidden="true" />
                              )
                            ) : (
                              <span className={cn("text-sm", plan === "pro" ? "font-medium text-mk-accent" : "text-mk-ink-80")}>
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
      <section className="border-t bg-background border-border">
        <div className="mx-auto max-w-3xl px-6 py-24 lg:py-32">
          <div className="text-center">
            <h2 className="m-0 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground text-balance lg:text-4xl">
              {t("faqTitleLead")} {t("faqTitleHighlight")}
            </h2>
          </div>
          <div className="mt-12">
            <Faq items={faqs.map((faq) => ({ q: faq.q, a: faq.a.replace("{trialDays}", String(TRIAL_DAYS)) }))} />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="flex flex-col items-start gap-8 rounded-3xl bg-mk-accent px-8 py-12 text-white sm:px-12 lg:flex-row lg:items-center lg:justify-between lg:py-16">
          <div className="max-w-xl">
            <h2 className="m-0 text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-4xl">
              {t("cta.title", { trialDays: TRIAL_DAYS })}
            </h2>
            <p className="m-0 mt-3 text-[17px] leading-7 text-white/85">
              {t("cta.subtitle", { trialEndDay: TRIAL_DAYS + 1 })}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" className="h-12 bg-white px-6 text-[15px] text-mk-accent hover:bg-white/90" asChild>
              <NextLink href="/onboarding">{t("cta.primaryButton")}</NextLink>
            </Button>
            <Button size="lg" variant="ghost" className="h-12 px-6 text-[15px] text-white hover:bg-white/10 hover:text-white" asChild>
              <Link href="/contact">{t("cta.secondaryButton")}</Link>
            </Button>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
