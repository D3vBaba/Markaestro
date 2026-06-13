"use client";

import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const coreFeatures = [
  {
    title: "Multi-Channel Publishing",
    description: "Compose once, publish everywhere. Write a single post and adapt it for Facebook, Instagram, and TikTok in one click. Schedule for optimal timing or publish instantly.",
    details: [
      "Unified composer with per-channel preview",
      "Drag-and-drop media management",
      "Bulk scheduling for content calendars",
      "Auto-resizing images to platform specs",
    ],
  },
  {
    title: "Media Upload & Library",
    description: "Bring your own photography, video, and brand assets. Markaestro stores them per workspace and attaches them to posts with a single drop.",
    details: [
      "JPG, PNG, WebP, MP4, MOV, and WebM support",
      "Up to 250 MB per video, 10 MB per image",
      "Per-channel format checks before publish",
      "Reuse uploaded media across multiple posts",
    ],
  },
  {
    title: "Multi-Channel Previews",
    description: "See how every post will look on Facebook, Instagram, and TikTok before you publish. Captions, aspect ratios, character limits, and media specs are all rendered live.",
    details: [
      "Pixel-accurate previews per platform",
      "Live caption character-count tracking",
      "Per-channel aspect-ratio guidance",
      "Catch formatting issues before they ship",
    ],
  },
  {
    title: "Analytics Dashboard",
    description: "See how every post performs in one unified view. Track engagement, reach, and interactions across all connected channels without exporting spreadsheets.",
    details: [
      "Real-time publishing activity charts",
      "Per-channel engagement breakdown",
      "Post-level performance trends",
      "Export-ready reporting",
    ],
  },
  {
    title: "OAuth Integrations",
    description: "Connect your accounts in one click with industry-standard OAuth. No manual API keys, no token juggling. Markaestro securely stores and refreshes credentials for you.",
    details: [
      "One-click connect for Meta and TikTok",
      "Encrypted token storage at rest",
      "Automatic token refresh",
      "Granular disconnect per platform",
    ],
  },
];

const platformFeatures = [
  {
    title: "Workspace Management",
    description: "Organize brands, clients, or business units into isolated workspaces. Each workspace has its own products, integrations, and team members.",
  },
  {
    title: "Scheduling & Calendar",
    description: "Queue posts on a unified calendar across all your channels. Reschedule with a drag, duplicate posts in a click, and keep a clear view of what's going out when.",
  },
  {
    title: "Role-Based Access",
    description: "Control who can publish, edit, or view with three-tier roles: Owner, Admin, and Member. Keep sensitive settings locked down while your team moves fast.",
  },
];

export default function FeaturesPage() {
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
            <p className="mk-eyebrow">Platform</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] leading-[1.05] lg:text-6xl">
              Everything you need to <span className="text-primary">grow</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              From first draft to published post, Markaestro handles every step of your social workflow. One platform, zero context-switching.
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
                  className="rounded-xl p-10 lg:p-14"
                  style={{
                    background: "var(--mk-surface)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
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
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Platform Features */}
      <section className="border-t">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mk-eyebrow">Platform</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-4xl">
              Built for teams that <span className="text-primary">move fast</span>
            </h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              Beyond the core tools, Markaestro gives you the infrastructure to scale your marketing operations.
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
              Ready to see it in action?
            </h2>
            <p
              className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
              style={{
                color: "color-mix(in oklch, var(--mk-paper) 70%, transparent)",
                letterSpacing: "-0.005em",
              }}
            >
              Start for free. No credit card required. Connect your first channel in under two minutes.
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button
                  size="lg"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{ background: "var(--mk-paper)", color: "var(--mk-ink)" }}
                >
                  Get started free
                </Button>
              </Link>
              <Link href="/contact">
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{ color: "color-mix(in oklch, var(--mk-paper) 80%, transparent)" }}
                >
                  Contact sales
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
