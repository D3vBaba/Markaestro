"use client";

import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const channels = [
  {
    name: "Facebook",
    category: "Social",
    color: "#1877F2",
    description: "Reach billions on the world's largest social network. Publish to Pages and manage feed posts with full creative control.",
    capabilities: [
      "Page feed posts with rich media",
      "Link posts with preview cards",
      "Photo and video publishing",
      "Carousel and multi-image posts",
      "Scheduling for optimal engagement",
      "Per-page targeting per product",
    ],
    connection: "OAuth via Meta Business Suite",
  },
  {
    name: "Instagram",
    category: "Social",
    color: "#E4405F",
    description: "Publish to Instagram Business accounts directly from Markaestro. Feed posts, carousels, and Stories with auto-formatted media for every placement.",
    capabilities: [
      "Single image and video feed posts",
      "Carousel posts (up to 10 slides)",
      "Auto-crop to 1:1 and 4:5 ratios",
      "Caption with hashtag optimization",
      "Scheduling for best engagement times",
      "Instagram Login for standalone professional accounts",
    ],
    connection: "OAuth via Meta (linked to Facebook Page)",
  },
  {
    name: "TikTok",
    category: "Social",
    color: "#000000",
    description: "Reach Gen Z and beyond on the fastest-growing short-form platform. Markaestro pushes photos and videos into the creator's TikTok inbox, then tracks when they're ready for final review in TikTok.",
    capabilities: [
      "Video and photo inbox handoff",
      "Creator review inside TikTok",
      "Scheduled delivery into TikTok inbox",
      "Fast status polling after handoff",
      "Status tracking inside Markaestro",
    ],
    connection: "OAuth via TikTok for Developers",
  },
];

const stats = [
  { value: "3", label: "Social Channels", sub: "Facebook, Instagram, TikTok" },
  { value: "1", label: "Dashboard", sub: "Unified publishing & analytics" },
  { value: "0", label: "Manual Tokens", sub: "Fully OAuth, fully automated" },
];

export default function ChannelsPage() {
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
            <p className="mk-eyebrow">Channels</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] leading-[1.05] lg:text-6xl">
              Reach your audience <span className="text-primary">everywhere</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Connect once and publish to every major platform. Markaestro handles the API differences, character limits, and media requirements so you can focus on the message.
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
                className="px-5 py-7 text-center"
                style={{ background: "var(--mk-paper)" }}
              >
                <p
                  className="text-[28px] sm:text-[32px] font-semibold mk-figure"
                  style={{ color: "var(--mk-accent)", letterSpacing: "-0.03em" }}
                >
                  {stat.value}
                </p>
                <p
                  className="mt-2 text-[12.5px] font-semibold"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                >
                  {stat.label}
                </p>
                <p
                  className="mt-0.5 text-[11px]"
                  style={{ color: "var(--mk-ink-60)" }}
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
        className="border-t"
        style={{ background: "var(--mk-paper)", borderColor: "var(--mk-rule)" }}
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
                        style={{ backgroundColor: channel.color }}
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
                      className="mt-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[10.5px] uppercase"
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
                    className="border-t lg:border-t-0 lg:border-l p-8 lg:p-12"
                    style={{
                      background: "var(--mk-surface)",
                      borderColor: "var(--mk-rule)",
                    }}
                  >
                    <p className="mk-eyebrow mb-5">Capabilities</p>
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
            <p className="mk-eyebrow">How It Works</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-4xl">
              Connected in <span className="text-primary">three steps</span>
            </h2>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            {[
              { step: "01", title: "Connect", desc: "Click 'Connect' on any channel. Authorize via OAuth. Markaestro securely stores and auto-refreshes your tokens." },
              { step: "02", title: "Create", desc: "Write your content in the unified composer. Preview how it looks on each platform before publishing." },
              { step: "03", title: "Publish", desc: "Hit publish or schedule for later. Markaestro handles formatting, media specs, and API calls for every channel." },
            ].map((item) => (
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
                  className="mt-5 text-[14px] font-semibold"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                >
                  {item.title}
                </h3>
                <p
                  className="mt-2 text-[13px] leading-relaxed"
                  style={{ color: "var(--mk-ink-60)" }}
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
        className="border-t"
        style={{ background: "var(--mk-ink)", borderColor: "var(--mk-rule)" }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              className="text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
              style={{ color: "var(--mk-paper)", letterSpacing: "-0.03em" }}
            >
              Connect your first channel in under two minutes
            </h2>
            <p
              className="mt-4 text-[14px] sm:text-[15px]"
              style={{
                color: "color-mix(in oklch, var(--mk-paper) 70%, transparent)",
              }}
            >
              No API keys. No developer setup. Just click, authorize, and start publishing.
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
              <Link href="/features">
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{
                    color: "color-mix(in oklch, var(--mk-paper) 80%, transparent)",
                  }}
                >
                  See all features
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
