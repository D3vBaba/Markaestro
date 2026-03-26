"use client";

import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, HelpCircle } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const tiers = [
  {
    name: "Free",
    price: { monthly: 0, annual: 0 },
    description: "For individuals getting started with social publishing.",
    cta: "Get Started Free",
    ctaVariant: "outline" as const,
    highlighted: false,
    features: [
      "3 social channels",
      "10 posts per month",
      "5 AI content generations",
      "1 team member",
      "Basic analytics",
      "1 workspace",
    ],
  },
  {
    name: "Starter",
    price: { monthly: 29, annual: 24 },
    description: "For small teams publishing across multiple channels.",
    cta: "Start Free Trial",
    ctaVariant: "outline" as const,
    highlighted: false,
    features: [
      "10 social channels",
      "Unlimited posts",
      "50 AI content generations",
      "2 team members",
      "Full analytics dashboard",
      "2 workspaces",
      "Brand voice profiles",
      "Content calendar",
    ],
  },
  {
    name: "Pro",
    price: { monthly: 79, annual: 66 },
    description: "For growing teams that need ads, AI, and collaboration.",
    cta: "Start Free Trial",
    ctaVariant: "default" as const,
    highlighted: true,
    badge: "Most Popular",
    features: [
      "25 social channels",
      "Unlimited posts",
      "200 AI generations (text + images)",
      "5 team members",
      "Ad campaign management",
      "Meta Ads + Google Ads",
      "Advanced analytics & reporting",
      "5 workspaces",
      "Brand voice + brand identity",
      "Approval workflows",
      "Priority support",
    ],
  },
  {
    name: "Business",
    price: { monthly: 199, annual: 166 },
    description: "For agencies and enterprises at scale.",
    cta: "Contact Sales",
    ctaVariant: "outline" as const,
    highlighted: false,
    features: [
      "50 social channels",
      "Unlimited posts",
      "Unlimited AI generations",
      "Unlimited team members",
      "Everything in Pro",
      "Unlimited workspaces",
      "API access",
      "Custom integrations",
      "Dedicated account manager",
      "SSO & advanced security",
      "White-label reporting",
    ],
  },
];

const comparisonCategories = [
  {
    name: "Publishing",
    features: [
      { name: "Social channels", free: "3", starter: "10", pro: "25", business: "50" },
      { name: "Posts per month", free: "10", starter: "Unlimited", pro: "Unlimited", business: "Unlimited" },
      { name: "Content calendar", free: false, starter: true, pro: true, business: true },
      { name: "Bulk scheduling", free: false, starter: false, pro: true, business: true },
    ],
  },
  {
    name: "AI",
    features: [
      { name: "AI content generations", free: "5/mo", starter: "50/mo", pro: "200/mo", business: "Unlimited" },
      { name: "AI image generation", free: false, starter: true, pro: true, business: true },
      { name: "Brand voice profiles", free: false, starter: true, pro: true, business: true },
      { name: "Brand identity", free: false, starter: false, pro: true, business: true },
    ],
  },
  {
    name: "Advertising",
    features: [
      { name: "Meta Ads", free: false, starter: false, pro: true, business: true },
      { name: "Google Ads", free: false, starter: false, pro: true, business: true },
      { name: "Audience targeting", free: false, starter: false, pro: true, business: true },
      { name: "A/B creative testing", free: false, starter: false, pro: true, business: true },
    ],
  },
  {
    name: "Team & Workspace",
    features: [
      { name: "Team members", free: "1", starter: "2", pro: "5", business: "Unlimited" },
      { name: "Workspaces", free: "1", starter: "2", pro: "5", business: "Unlimited" },
      { name: "Approval workflows", free: false, starter: false, pro: true, business: true },
      { name: "Role-based access", free: false, starter: true, pro: true, business: true },
    ],
  },
  {
    name: "Support & Security",
    features: [
      { name: "Email support", free: true, starter: true, pro: true, business: true },
      { name: "Priority support", free: false, starter: false, pro: true, business: true },
      { name: "API access", free: false, starter: false, pro: false, business: true },
      { name: "SSO", free: false, starter: false, pro: false, business: true },
    ],
  },
];

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
    q: "What happens when I hit my AI generation limit?",
    a: "You can continue using all other features. AI generations reset at the start of each billing cycle. You can upgrade your plan at any time for more generations.",
  },
  {
    q: "Is there a free trial for paid plans?",
    a: "Yes. All paid plans include a 14-day free trial with full access. No credit card required to start.",
  },
  {
    q: "Do you offer discounts for nonprofits or startups?",
    a: "Yes. We offer 50% off for verified nonprofits and early-stage startups (under $1M revenue). Contact us to apply.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit and debit cards (Visa, Mastercard, Amex) and PayPal. Enterprise plans can pay by invoice.",
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Pricing</p>
            <h1 className="mt-4 text-4xl font-normal tracking-tight lg:text-6xl font-[family-name:var(--font-display)]">
              Simple, transparent <span className="text-primary">pricing</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Start free, scale as you grow. No hidden fees, no per-user surprises. Every plan includes a 14-day free trial.
            </p>

            {/* Billing toggle */}
            <div className="mt-10 inline-flex items-center gap-3 rounded-full border bg-muted/30 p-1.5">
              <button
                className={cn(
                  "rounded-full px-5 py-2 text-sm font-medium transition-all",
                  !annual ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setAnnual(false)}
              >
                Monthly
              </button>
              <button
                className={cn(
                  "rounded-full px-5 py-2 text-sm font-medium transition-all",
                  annual ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setAnnual(true)}
              >
                Annual <span className="ml-1 text-xs opacity-80">Save 17%</span>
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="grid gap-6 lg:grid-cols-4">
            {tiers.map((tier, i) => (
              <motion.div
                key={tier.name}
                className={cn(
                  "rounded-2xl border bg-background p-8 flex flex-col",
                  tier.highlighted
                    ? "border-primary shadow-lg ring-1 ring-primary/20 relative"
                    : "border-border/40"
                )}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.4, ease }}
              >
                {tier.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-primary px-4 py-1 text-xs font-semibold text-white">
                      {(tier as { badge?: string }).badge}
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
                      ${annual ? tier.price.annual : tier.price.monthly}
                    </span>
                    {tier.price.monthly > 0 && (
                      <span className="text-sm text-muted-foreground">/mo</span>
                    )}
                  </div>
                  {annual && tier.price.monthly > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Billed annually (${(annual ? tier.price.annual : tier.price.monthly) * 12}/yr)
                    </p>
                  )}
                </div>
                <Link href={tier.name === "Business" ? "/contact" : "/login"} className="mt-6">
                  <Button
                    variant={tier.ctaVariant}
                    className={cn(
                      "w-full rounded-xl h-11",
                      tier.highlighted && "bg-primary hover:bg-primary/90"
                    )}
                  >
                    {tier.cta}
                    {tier.name !== "Business" && <ArrowRight className="ml-2 h-4 w-4" />}
                  </Button>
                </Link>
                <div className="mt-8 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">Includes</p>
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
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="border-t">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-normal tracking-tight lg:text-3xl font-[family-name:var(--font-display)]">
              Compare <span className="text-primary">every feature</span>
            </h2>
            <p className="mt-4 text-muted-foreground">
              See exactly what&apos;s included in each plan.
            </p>
          </div>

          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-4 text-left font-medium text-muted-foreground w-[200px]" />
                  <th className="py-4 text-center font-semibold w-[120px]">Free</th>
                  <th className="py-4 text-center font-semibold w-[120px]">Starter</th>
                  <th className="py-4 text-center font-semibold w-[120px]">
                    <span className="text-primary">Pro</span>
                  </th>
                  <th className="py-4 text-center font-semibold w-[120px]">Business</th>
                </tr>
              </thead>
              <tbody>
                {comparisonCategories.map((cat) => (
                  <>
                    <tr key={cat.name}>
                      <td colSpan={5} className="pt-8 pb-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-foreground">{cat.name}</p>
                      </td>
                    </tr>
                    {cat.features.map((feature) => (
                      <tr key={feature.name} className="border-b border-border/40">
                        <td className="py-3 text-muted-foreground">{feature.name}</td>
                        {(["free", "starter", "pro", "business"] as const).map((plan) => (
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
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-3xl px-6 py-24 lg:py-32">
          <div className="text-center">
            <h2 className="text-2xl font-normal tracking-tight lg:text-3xl font-[family-name:var(--font-display)]">
              Pricing <span className="text-primary">FAQ</span>
            </h2>
          </div>
          <div className="mt-12 space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border/40 bg-background overflow-hidden"
              >
                <button
                  className="flex w-full items-center justify-between p-6 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-sm font-medium text-foreground pr-4">{faq.q}</span>
                  <HelpCircle
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-colors",
                      openFaq === i && "text-primary"
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
      <section className="border-t bg-primary text-white">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-normal tracking-tight lg:text-4xl font-[family-name:var(--font-display)]">
              Start free, upgrade when you&apos;re ready
            </h2>
            <p className="mt-5 text-white/70">
              No credit card required. Full access for 14 days on any paid plan.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" variant="secondary" className="h-13 px-10 text-sm rounded-2xl bg-white text-foreground hover:bg-white/90">
                  Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/contact">
                <Button size="lg" variant="ghost" className="h-13 px-10 text-sm text-white/80 hover:text-white hover:bg-white/10 rounded-2xl">
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
