"use client";

import Link from "next/link";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function LandingPage() {
  return (
    <MarketingLayout>
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-7xl px-6 py-28 lg:py-40">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-5 py-2 text-xs font-semibold text-primary tracking-wide">
              AI-Powered Marketing Automation
            </div>
            <h1 className="text-5xl font-normal tracking-tight text-foreground lg:text-7xl lg:leading-[1.08] font-[family-name:var(--font-display)]">
              Your entire marketing engine{" "}
              <span className="text-primary">in one platform</span>
            </h1>
            <p className="mt-7 text-lg text-muted-foreground leading-relaxed lg:text-xl max-w-2xl mx-auto">
              Publish to every social channel, generate branded content with AI, and track everything from a single dashboard.
            </p>
            <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" className="h-13 px-10 text-sm rounded-2xl">
                  Start for Free
                </Button>
              </Link>
              <Link href="/features">
                <Button variant="outline" size="lg" className="h-13 px-10 text-sm rounded-2xl">
                  See Features
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Hero stats */}
          <motion.div
            className="mx-auto mt-24 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-2xl border bg-border/40"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease }}
          >
            {[
              { value: "10hrs", label: "Saved per week" },
              { value: "5+", label: "Channels, one click" },
              { value: "30s", label: "AI content generation" },
            ].map((stat) => (
              <div key={stat.label} className="bg-background px-6 py-8 text-center">
                <p className="text-3xl font-bold tracking-tight text-primary">{stat.value}</p>
                <p className="mt-2 text-xs text-muted-foreground font-medium tracking-wide uppercase">{stat.label}</p>
              </div>
            ))}
          </motion.div>

          {/* Social proof */}
          <motion.div
            className="mx-auto mt-16 max-w-3xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.6, ease }}
          >
            <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground mb-6">
              Trusted by marketing teams at
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-40">
              {["Acme Corp", "TechFlow", "GrowthLab", "Launchpad", "ScaleUp", "BrandForge"].map((name) => (
                <span key={name} className="text-sm font-semibold tracking-tight text-foreground">
                  {name}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Features Preview ─── */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-7xl px-6 py-28 lg:py-36">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Platform</p>
            <h2 className="mt-4 text-3xl font-normal tracking-tight text-foreground lg:text-4xl font-[family-name:var(--font-display)]">
              Everything you need to <span className="text-primary">grow</span>
            </h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              From first draft to published campaign, Markaestro handles every step of your marketing workflow.
            </p>
          </div>

          <div className="mt-20 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Multi-Channel Publishing", desc: "Publish to Facebook, Instagram, and TikTok from a single composer. Schedule posts or publish instantly." },
              { title: "AI Content Generation", desc: "Generate on-brand copy powered by your product's brand voice. Multiple tones, formats, and channel-specific optimization." },
              { title: "AI Image Generation", desc: "Create branded visuals with Gemini Imagen 3 and DALL-E. Auto-matches your brand colors, style, and product identity." },
              { title: "Smart Scheduling", desc: "Queue posts for optimal engagement windows with AI-suggested timing per channel." },
              { title: "Analytics Dashboard", desc: "Track engagement rates and post performance across all channels in real time." },
              { title: "OAuth Integrations", desc: "One-click connect to Meta and TikTok via secure OAuth. No manual token management required." },
            ].map(({ title, desc }) => (
              <div
                key={title}
                className="rounded-2xl bg-background p-8 transition-all duration-300 hover:translate-y-[-3px] hover:shadow-lg border border-border/40"
              >
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link href="/features">
              <Button variant="outline" className="rounded-2xl">
                Explore All Features
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Channels Preview ─── */}
      <section className="border-t">
        <div className="mx-auto max-w-7xl px-6 py-28 lg:py-36">
          <div className="grid gap-20 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Channels</p>
              <h2 className="mt-4 text-3xl font-normal tracking-tight text-foreground lg:text-4xl font-[family-name:var(--font-display)]">
                Reach your audience <span className="text-primary">everywhere</span>
              </h2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Connect once and publish to every major platform. Markaestro handles the API differences, character limits, and media requirements for each channel.
              </p>
              <div className="mt-10 space-y-5">
                {[
                  { name: "Facebook & Instagram", desc: "OAuth-connected via Meta. Pages, feed posts, stories, and IG business publishing." },
                  { name: "TikTok", desc: "Photo and video content staged inside Markaestro for final review and manual posting." },
                ].map((ch) => (
                  <div key={ch.name} className="flex items-start gap-4">
                    <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{ch.name}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{ch.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-10">
                <Link href="/channels">
                  <Button variant="outline" className="rounded-2xl">
                    See All Channels
                  </Button>
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Social Channels", value: "3", sub: "Facebook, Instagram, TikTok" },
                { label: "AI Providers", value: "2", sub: "Gemini Imagen, OpenAI DALL-E" },
                { label: "Dashboards", value: "1", sub: "Unified publishing & analytics" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl bg-muted/30 p-7 transition-all duration-300 hover:translate-y-[-2px] border border-border/40">
                  <p className="text-4xl font-bold tracking-tight text-primary">{item.value}</p>
                  <p className="mt-2 text-xs font-semibold text-foreground">{item.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── AI Studio Preview ─── */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto max-w-7xl px-6 py-28 lg:py-36">
          <div className="grid gap-20 lg:grid-cols-2 lg:items-center">
            <div className="order-2 lg:order-1">
              <div className="space-y-4">
                <div className="rounded-2xl border bg-background p-8">
                  <div className="flex items-center gap-2 text-xs font-semibold text-primary tracking-wide uppercase">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    AI Content Generation
                  </div>
                  <div className="mt-5 space-y-3 font-mono text-xs text-muted-foreground">
                    <div className="rounded-xl border bg-muted/30 p-4">
                      <span className="text-foreground font-semibold">Brand Voice:</span> Professional, confident, results-driven
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-4">
                      <span className="text-foreground font-semibold">Tone:</span> Authoritative yet approachable
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-4">
                      <span className="text-foreground font-semibold">Output:</span> Channel-optimized copy for Facebook, Instagram, TikTok
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">AI Studio</p>
              <h2 className="mt-4 text-3xl font-normal tracking-tight text-foreground lg:text-4xl font-[family-name:var(--font-display)]">
                Content that sounds <span className="text-primary">like you</span>
              </h2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Train Markaestro on your brand voice, product identity, and visual style. Every piece of content — text and images — is generated to match your brand, not a generic template.
              </p>
              <div className="mt-10 space-y-5">
                {[
                  "Brand voice profiles per product with tone, style, and vocabulary",
                  "Gemini Imagen 3 for photorealistic branded images",
                  "Channel-aware formatting: hashtags, char limits, media specs",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-4">
                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <p className="text-sm text-muted-foreground">{item}</p>
                  </div>
                ))}
              </div>
              <div className="mt-10">
                <Link href="/ai-studio">
                  <Button variant="outline" className="rounded-2xl">
                    Explore AI Studio
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="border-t bg-primary text-white">
        <div className="mx-auto max-w-7xl px-6 py-28 lg:py-36">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-normal tracking-tight lg:text-4xl font-[family-name:var(--font-display)]">
              Ready to automate your marketing?
            </h2>
            <p className="mt-5 text-white/70">
              Set up in minutes. Connect your channels, train your brand voice, and start publishing.
            </p>
            <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" variant="secondary" className="h-13 px-10 text-sm rounded-2xl bg-white text-foreground hover:bg-white/90">
                  Get Started Free
                </Button>
              </Link>
              <Link href="/contact">
                <Button size="lg" variant="ghost" className="h-13 px-10 text-sm text-white/80 hover:text-white hover:bg-white/10 rounded-2xl">
                  Contact Sales
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
