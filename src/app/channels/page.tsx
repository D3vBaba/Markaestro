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
    description: "Reach billions on the world's largest social network. Publish to Pages, manage feed posts, and run targeted ad campaigns with full creative control.",
    capabilities: [
      "Page feed posts with rich media",
      "Link posts with preview cards",
      "Photo and video publishing",
      "Carousel and multi-image posts",
      "Campaign creation via Meta Ads API",
      "Audience targeting and lookalike audiences",
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
      "Ad campaigns via Meta Ads integration",
    ],
    connection: "OAuth via Meta (linked to Facebook Page)",
  },
  {
    name: "TikTok",
    category: "Social",
    color: "#000000",
    description: "Reach Gen Z and beyond on the fastest-growing short-form platform. Upload videos and photos through TikTok's Content Posting API with full privacy controls.",
    capabilities: [
      "Video content publishing",
      "Photo mode posts",
      "Privacy and interaction controls",
      "Disclosure and branded content labels",
      "Auto-retry for processing delays",
      "Content scheduling",
    ],
    connection: "OAuth via TikTok for Developers",
  },
  {
    name: "Meta Ads",
    category: "Advertising",
    color: "#1877F2",
    description: "Run paid campaigns across Facebook and Instagram's combined ad inventory. Create campaigns, set budgets, define audiences, and monitor performance in real time.",
    capabilities: [
      "Campaign, ad set, and ad creation",
      "Custom and lookalike audiences",
      "Placement optimization (Feed, Stories, Reels)",
      "Budget and bid strategy controls",
      "Creative A/B testing",
      "Cross-platform performance analytics",
    ],
    connection: "OAuth via Meta Business Suite",
  },
];

const stats = [
  { value: "3", label: "Social Channels", sub: "Facebook, Instagram, TikTok" },
  { value: "2", label: "Ad Platforms", sub: "Meta Ads, TikTok Ads" },
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Channels</p>
            <h1 className="mt-4 text-4xl font-normal tracking-tight lg:text-6xl font-[family-name:var(--font-display)]">
              Reach your audience <span className="text-primary">everywhere</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Connect once and publish to every major platform. Markaestro handles the API differences, character limits, and media requirements so you can focus on the message.
            </p>
          </motion.div>

          {/* Stats */}
          <motion.div
            className="mx-auto mt-20 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border/40 sm:grid-cols-4"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease }}
          >
            {stats.map((stat) => (
              <div key={stat.label} className="bg-background px-6 py-8 text-center">
                <p className="text-3xl font-bold tracking-tight text-primary">{stat.value}</p>
                <p className="mt-2 text-xs font-semibold text-foreground">{stat.label}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{stat.sub}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Channel Cards */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="space-y-16">
            {channels.map((channel) => (
              <motion.div
                key={channel.name}
                className="rounded-2xl border border-border/40 bg-background overflow-hidden"
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
                      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                        {channel.category}
                      </span>
                    </div>
                    <h3 className="mt-4 text-2xl font-normal tracking-tight font-[family-name:var(--font-display)]">
                      {channel.name}
                    </h3>
                    <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                      {channel.description}
                    </p>
                    <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
                      {channel.connection}
                    </div>
                  </div>
                  <div className="border-t lg:border-t-0 lg:border-l border-border/40 p-8 lg:p-12 bg-muted/10">
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-foreground mb-5">Capabilities</p>
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">How It Works</p>
            <h2 className="mt-4 text-3xl font-normal tracking-tight lg:text-4xl font-[family-name:var(--font-display)]">
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
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/5 text-xl font-bold text-primary">
                  {item.step}
                </div>
                <h3 className="mt-5 text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
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
              Connect your first channel in under two minutes
            </h2>
            <p className="mt-5 text-white/70">
              No API keys. No developer setup. Just click, authorize, and start publishing.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" variant="secondary" className="h-13 px-10 text-sm rounded-2xl bg-white text-foreground hover:bg-white/90">
                  Get Started Free
                </Button>
              </Link>
              <Link href="/features">
                <Button size="lg" variant="ghost" className="h-13 px-10 text-sm text-white/80 hover:text-white hover:bg-white/10 rounded-2xl">
                  See All Features
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
