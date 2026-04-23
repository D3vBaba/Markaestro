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
        <div className="relative mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28 lg:py-36">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <div
              className="mb-7 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[10.5px] uppercase"
              style={{
                border: "1px solid color-mix(in oklch, var(--mk-accent) 24%, var(--mk-rule))",
                background: "var(--mk-accent-soft)",
                color: "var(--mk-accent)",
                letterSpacing: "0.14em",
              }}
            >
              AI-powered marketing automation
            </div>
            <h1
              className="text-[40px] sm:text-[56px] lg:text-[72px] font-semibold leading-[1.05]"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.035em" }}
            >
              Your entire marketing engine{" "}
              <span style={{ color: "var(--mk-accent)" }}>in one platform</span>
            </h1>
            <p
              className="mt-6 text-[15px] sm:text-[17px] lg:text-[18px] leading-relaxed max-w-2xl mx-auto"
              style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
            >
              Publish to every social channel, generate branded content with AI,
              and track everything from a single dashboard.
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" className="h-11 px-7 rounded-lg text-[13.5px]">
                  Start for free
                </Button>
              </Link>
              <Link href="/features">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                >
                  See features
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Hero stats */}
          <motion.div
            className="mx-auto mt-20 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-xl"
            style={{
              background: "var(--mk-rule)",
              border: "1px solid var(--mk-rule)",
            }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease }}
          >
            {[
              { value: "10hrs", label: "Saved per week" },
              { value: "5+", label: "Channels, one click" },
              { value: "30s", label: "AI content generation" },
            ].map((stat) => (
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
                <p className="mt-2 mk-eyebrow">{stat.label}</p>
              </div>
            ))}
          </motion.div>

          {/* Social proof */}
          <motion.div
            className="mx-auto mt-14 max-w-3xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.6, ease }}
          >
            <p
              className="text-center mk-eyebrow mb-5"
              style={{ letterSpacing: "0.2em" }}
            >
              Trusted by marketing teams at
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 opacity-50">
              {["Acme Corp", "TechFlow", "GrowthLab", "Launchpad", "ScaleUp", "BrandForge"].map((name) => (
                <span
                  key={name}
                  className="text-[13px] font-semibold"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
                >
                  {name}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Features Preview ─── */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--mk-rule)",
          background: "var(--mk-paper)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mk-eyebrow">Platform</p>
            <h2
              className="mt-3 text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
            >
              Everything you need to{" "}
              <span style={{ color: "var(--mk-accent)" }}>grow</span>
            </h2>
            <p
              className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
              style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
            >
              From first draft to published campaign, Markaestro handles every
              step of your marketing workflow.
            </p>
          </div>

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Multi-channel publishing", desc: "Publish to Facebook, Instagram, and TikTok from a single composer. Schedule posts or publish instantly." },
              { title: "AI content generation", desc: "Generate on-brand copy powered by your product's brand voice. Multiple tones, formats, and channel-specific optimization." },
              { title: "AI image generation", desc: "Create branded visuals with Gemini Imagen 3 and DALL-E. Auto-matches your brand colors, style, and product identity." },
              { title: "Smart scheduling", desc: "Queue posts for optimal engagement windows with AI-suggested timing per channel." },
              { title: "Analytics dashboard", desc: "Track engagement rates and post performance across all channels in real time." },
              { title: "OAuth integrations", desc: "One-click connect to Meta and TikTok via secure OAuth. No manual token management required." },
            ].map(({ title, desc }) => (
              <div
                key={title}
                className="rounded-xl p-6"
                style={{
                  background: "var(--mk-paper)",
                  border: "1px solid var(--mk-rule)",
                }}
              >
                <h3
                  className="text-[14px] font-semibold"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
                >
                  {title}
                </h3>
                <p
                  className="mt-2.5 text-[13px] leading-relaxed"
                  style={{ color: "var(--mk-ink-60)" }}
                >
                  {desc}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link href="/features">
              <Button variant="outline" className="rounded-lg h-9 text-[13px]">
                Explore all features
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Channels Preview ─── */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--mk-rule)",
          background: "var(--mk-surface)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mk-eyebrow">Channels</p>
              <h2
                className="mt-3 text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
                style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
              >
                Reach your audience{" "}
                <span style={{ color: "var(--mk-accent)" }}>everywhere</span>
              </h2>
              <p
                className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
                style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
              >
                Connect once and publish to every major platform. Markaestro
                handles the API differences, character limits, and media
                requirements for each channel.
              </p>
              <div className="mt-8 flex flex-col gap-4">
                {[
                  { name: "Facebook & Instagram", desc: "OAuth-connected via Meta. Pages, feed posts, stories, and IG business publishing." },
                  { name: "TikTok", desc: "Photo and video content handed off to the creator's TikTok inbox for final review and posting." },
                ].map((ch) => (
                  <div key={ch.name} className="flex items-start gap-3">
                    <div
                      className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "var(--mk-accent)" }}
                    />
                    <div>
                      <p
                        className="text-[13.5px] font-semibold"
                        style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                      >
                        {ch.name}
                      </p>
                      <p
                        className="text-[13px] mt-0.5"
                        style={{ color: "var(--mk-ink-60)" }}
                      >
                        {ch.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link href="/channels">
                  <Button variant="outline" className="rounded-lg h-9 text-[13px]">
                    See all channels
                  </Button>
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Social channels", value: "3", sub: "Facebook, Instagram, TikTok" },
                { label: "AI providers", value: "2", sub: "Gemini Imagen, OpenAI DALL-E" },
                { label: "Dashboards", value: "1", sub: "Unified publishing & analytics" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl p-6"
                  style={{
                    background: "var(--mk-paper)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
                  <p
                    className="text-[36px] font-semibold mk-figure"
                    style={{ color: "var(--mk-accent)", letterSpacing: "-0.035em" }}
                  >
                    {item.value}
                  </p>
                  <p
                    className="mt-2 text-[12.5px] font-semibold"
                    style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                  >
                    {item.label}
                  </p>
                  <p
                    className="mt-0.5 text-[11.5px]"
                    style={{ color: "var(--mk-ink-60)" }}
                  >
                    {item.sub}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── AI Studio Preview ─── */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--mk-rule)",
          background: "var(--mk-paper)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <div className="order-2 lg:order-1">
              <div
                className="rounded-xl p-6"
                style={{
                  background: "var(--mk-surface)",
                  border: "1px solid var(--mk-rule)",
                }}
              >
                <div className="flex items-center gap-2 mk-eyebrow">
                  <span
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ background: "var(--mk-accent)" }}
                  />
                  AI content generation
                </div>
                <div className="mt-5 flex flex-col gap-2.5 font-mono text-[12px]">
                  {[
                    { label: "Brand voice", value: "Professional, confident, results-driven" },
                    { label: "Tone", value: "Authoritative yet approachable" },
                    { label: "Output", value: "Channel-optimized copy for Facebook, Instagram, TikTok" },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="rounded-lg px-3.5 py-3"
                      style={{
                        background: "var(--mk-paper)",
                        border: "1px solid var(--mk-rule)",
                      }}
                    >
                      <span
                        className="font-semibold"
                        style={{ color: "var(--mk-ink)" }}
                      >
                        {row.label}:
                      </span>{" "}
                      <span style={{ color: "var(--mk-ink-60)" }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <p className="mk-eyebrow">AI Studio</p>
              <h2
                className="mt-3 text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
                style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
              >
                Content that sounds{" "}
                <span style={{ color: "var(--mk-accent)" }}>like you</span>
              </h2>
              <p
                className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
                style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
              >
                Train Markaestro on your brand voice, product identity, and
                visual style. Every piece of content — text and images — is
                generated to match your brand, not a generic template.
              </p>
              <div className="mt-8 flex flex-col gap-4">
                {[
                  "Brand voice profiles per product with tone, style, and vocabulary",
                  "Gemini Imagen 3 for photorealistic branded images",
                  "Channel-aware formatting: hashtags, char limits, media specs",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <div
                      className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "var(--mk-accent)" }}
                    />
                    <p
                      className="text-[13.5px]"
                      style={{ color: "var(--mk-ink-80)", letterSpacing: "-0.005em" }}
                    >
                      {item}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link href="/ai-studio">
                  <Button variant="outline" className="rounded-lg h-9 text-[13px]">
                    Explore AI Studio
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section
        className="border-t"
        style={{
          borderColor: "var(--mk-rule)",
          background: "var(--mk-ink)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p
              className="mk-eyebrow"
              style={{ color: "color-mix(in oklch, var(--mk-paper) 50%, transparent)" }}
            >
              Get started
            </p>
            <h2
              className="mt-3 text-[30px] sm:text-[36px] font-semibold leading-[1.1]"
              style={{ color: "var(--mk-paper)", letterSpacing: "-0.03em" }}
            >
              Ready to automate your marketing?
            </h2>
            <p
              className="mt-4 text-[14px] sm:text-[15px] leading-relaxed"
              style={{
                color: "color-mix(in oklch, var(--mk-paper) 70%, transparent)",
                letterSpacing: "-0.005em",
              }}
            >
              Set up in minutes. Connect your channels, train your brand voice,
              and start publishing.
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button
                  size="lg"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{
                    background: "var(--mk-paper)",
                    color: "var(--mk-ink)",
                  }}
                >
                  Get started free
                </Button>
              </Link>
              <Link href="/contact">
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{
                    color: "color-mix(in oklch, var(--mk-paper) 80%, transparent)",
                  }}
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
