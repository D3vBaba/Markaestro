"use client";

import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { ChevronDown, Check } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { PLANS, PLAN_TIERS, COMPARISON_CATEGORIES, TRIAL_DAYS } from "@/lib/stripe/plans";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const faqs = [
  {
    q: "Can I switch plans at any time?",
    a: "Yes. You can upgrade or downgrade your plan at any time. When upgrading, you'll be charged the prorated difference. When downgrading, the new rate takes effect at your next billing cycle.",
  },
  {
    q: "What counts as a 'social channel'?",
    a: "Each connected social account counts as one channel. For example, one Facebook Page, one Instagram Business account, and one TikTok account would be 3 channels.",
  },
  {
    q: "What counts as an AI generation?",
    a: "Text and image generations (social posts, campaigns, AI images) each use one AI generation credit. See the comparison table for monthly limits per plan.",
  },
  {
    q: "What happens when I hit my AI generation limit?",
    a: "You can continue using all other features — publishing, scheduling, and analytics stay available. Your AI generation quota resets at the start of each billing cycle, and you can upgrade your plan at any time for a higher quota.",
  },
  {
    q: "How does the free trial work?",
    a: `Every plan — monthly and annual — includes a ${TRIAL_DAYS}-day free trial. Your card is collected at signup but won't be charged until the trial ends. Cancel anytime during the trial and pay nothing.`,
  },
  {
    q: "Which plans include the free trial?",
    a: `All plans (Starter, Pro, Business) on both monthly and annual billing include the ${TRIAL_DAYS}-day free trial. Annual billing also saves you 18% compared to monthly.`,
  },
  {
    q: "Do you offer discounts for nonprofits or startups?",
    a: "Yes. We offer 50% off for verified nonprofits and early-stage startups (under $1M revenue). Contact us to apply.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit and debit cards (Visa, Mastercard, Amex). Enterprise plans can pay by invoice.",
  },
];

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

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
            <p className="mk-eyebrow">Pricing</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] leading-[1.05] lg:text-6xl">
              Your entire marketing engine,{" "}
              <span className="text-primary">one simple price</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              No hidden fees, no per-user surprises. Every plan includes a {TRIAL_DAYS}-day free trial.
              Cancel anytime.
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
                Monthly
              </button>
              <button
                className={cn(
                  "rounded-full px-5 py-2 text-sm font-medium transition-all",
                  annual ? "bg-mk-ink text-mk-paper" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setAnnual(true)}
              >
                Annual{" "}
                <span className="ml-1 rounded-full bg-mk-accent-soft text-mk-accent px-2 py-0.5 text-[10px] font-bold">
                  SAVE 18%
                </span>
              </button>
            </div>

            <motion.p
              className="mt-4 text-sm text-mk-pos font-medium"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {TRIAL_DAYS}-day free trial on all plans — no charge until day {TRIAL_DAYS + 1}
              {annual && " · Annual billing saves 18%"}
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="border-t" style={{ background: "var(--mk-paper)", borderColor: "var(--mk-rule)" }}>
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="grid gap-6 lg:grid-cols-3">
            {PLAN_TIERS.map((tierKey, i) => {
              const tier = PLANS[tierKey];
              const price = annual ? tier.price.annual : tier.price.monthly;
              const monthlyPrice = tier.price.monthly;
              const dailyCost = annual ? (tier.price.annual / 30).toFixed(2) : null;

              return (
                <motion.div
                  key={tier.name}
                  className={cn(
                    "rounded-xl border bg-card p-7 flex flex-col",
                    tier.highlighted
                      ? "border-primary shadow-lg ring-1 ring-primary/20 relative"
                      : "border-border/40"
                  )}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.4, ease }}
                >
                  {tier.highlighted && tier.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-primary px-4 py-1 text-xs font-semibold text-white">
                        {tier.badge}
                      </span>
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold">{tier.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>
                  </div>
                  <div className="mt-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold tracking-tight">
                        ${price}
                      </span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </div>
                    {annual && (
                      <div className="mt-1.5 space-y-0.5">
                        <p className="text-xs text-muted-foreground">
                          <span className="line-through text-muted-foreground/50">${monthlyPrice}/mo</span>
                          {" "}· Billed annually (${price * 12}/yr)
                        </p>
                        {dailyCost && (
                          <p className="text-xs text-mk-pos font-medium">
                            That&apos;s just ${dailyCost}/day
                          </p>
                        )}
                      </div>
                    )}
                    {!annual && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Billed monthly · Switch to annual and save 17%
                      </p>
                    )}
                  </div>
                  <Link href="/login" className="mt-6 block">
                    <Button
                      variant={tier.highlighted ? "default" : "outline"}
                      className={cn(
                        "w-full rounded-lg h-11 text-[13.5px]",
                        tier.highlighted && "bg-primary hover:bg-primary/90"
                      )}
                    >
                      {`Start ${TRIAL_DAYS}-Day Free Trial`}
                    </Button>
                  </Link>
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">
                    No charge for {TRIAL_DAYS} days · Cancel anytime
                  </p>
                  <div className="mt-8 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">Everything included</p>
                    <ul className="space-y-3">
                      {tier.features.map((feature) => (
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
              Compare <span className="text-primary">every feature</span>
            </h2>
            <p className="mt-4 text-muted-foreground">
              See exactly what&apos;s included in each plan.
            </p>
          </div>

          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-4 text-left font-medium text-muted-foreground w-[200px]" />
                  <th className="py-4 text-center font-semibold w-[120px]">Starter</th>
                  <th className="py-4 text-center font-semibold w-[120px]">
                    <span className="text-primary">Pro</span>
                  </th>
                  <th className="py-4 text-center font-semibold w-[120px]">Business</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_CATEGORIES.map((cat) => (
                  <>
                    <tr key={cat.name}>
                      <td colSpan={4} className="pt-8 pb-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-foreground">{cat.name}</p>
                      </td>
                    </tr>
                    {cat.features.map((feature) => (
                      <tr key={feature.name} className="border-b border-border/40">
                        <td className="py-3 text-muted-foreground">{feature.name}</td>
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
                  </>
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
              Pricing <span className="text-primary">FAQ</span>
            </h2>
          </div>
          <div className="mt-12 space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="rounded-xl border bg-card overflow-hidden"
              >
                <button
                  className="flex w-full items-center justify-between p-6 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-sm font-medium text-foreground pr-4">{faq.q}</span>
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
              Try Markaestro free for {TRIAL_DAYS} days
            </h2>
            <p className="mt-5 text-mk-paper/70">
              Full access on any annual plan. No charge until day {TRIAL_DAYS + 1}. Cancel anytime.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" variant="secondary" className="h-11 px-7 rounded-lg text-[13.5px] bg-mk-paper text-mk-ink hover:bg-mk-paper/90">
                  Start Free Trial
                </Button>
              </Link>
              <Link href="/contact">
                <Button size="lg" variant="ghost" className="h-11 px-7 rounded-lg text-[13.5px] text-mk-paper/80 hover:text-mk-paper hover:bg-mk-paper/10">
                  Talk to Sales
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
