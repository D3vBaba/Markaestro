"use client";

import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function AIStudioPage() {
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
            <p className="mk-eyebrow">AI Studio</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] leading-[1.05] lg:text-6xl">
              Content that sounds <span className="text-primary">like you</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Train Markaestro on your brand voice, product identity, and visual style. Every piece of content — text and images — is generated to match your brand, not a generic template.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Brand Voice */}
      <section className="border-t bg-mk-paper border-mk-rule">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="grid gap-16 lg:gap-24 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary tracking-wide">
                Brand Voice Engine
              </div>
              <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-3xl">
                Your voice, amplified by AI
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Every brand has a voice. Markaestro learns yours and applies it consistently across every channel, every campaign, every piece of content. Define it once, use it everywhere.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  { title: "Voice Profiles", desc: "Create distinct voice profiles per product — each with its own tone, vocabulary, and style rules." },
                  { title: "Tone Presets", desc: "Choose from Professional, Casual, Bold, or Witty. Or define a custom tone with your own adjectives." },
                  { title: "Channel Awareness", desc: "The same message adapts to Facebook's long-form, Instagram's visual focus, and TikTok's punchy brevity." },
                  { title: "Iteration Controls", desc: "Not quite right? Regenerate, tweak the tone, or ask for variations without losing context." },
                ].map((item) => (
                  <li key={item.title} className="flex items-start gap-4">
                    <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <motion.div
              className="space-y-4"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, ease }}
            >
              <div className="rounded-xl border bg-card p-6">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary tracking-wide uppercase">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Brand Voice Profile
                </div>
                <div className="mt-6 space-y-3 font-mono text-xs text-muted-foreground">
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <span className="text-foreground font-semibold">Voice:</span> Professional, confident, results-driven
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <span className="text-foreground font-semibold">Tone:</span> Authoritative yet approachable
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <span className="text-foreground font-semibold">Vocabulary:</span> Growth, precision, automate, scale, modern
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <span className="text-foreground font-semibold">Avoid:</span> Slang, jargon, passive voice, exclamation marks
                  </div>
                </div>
              </div>
              <div className="rounded-xl border bg-card p-6">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary tracking-wide uppercase">
                  Generated Output
                </div>
                <div className="mt-5 rounded-xl border bg-muted/30 p-5 text-sm text-muted-foreground leading-relaxed italic">
                  &ldquo;Scale your marketing without scaling your team. Markaestro automates the workflows that used to take hours — so you can focus on strategy, not scheduling.&rdquo;
                </div>
                <div className="mt-3 flex gap-2">
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-medium text-primary">Facebook</span>
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">Professional tone</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* AI Image Generation */}
      <section className="border-t">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="grid gap-16 lg:gap-24 lg:grid-cols-2 lg:items-center">
            <motion.div
              className="order-2 lg:order-1 space-y-4"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, ease }}
            >
              <div className="rounded-xl border bg-card p-6">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary tracking-wide uppercase">
                  Brand Identity
                </div>
                <div className="mt-5 grid grid-cols-5 gap-3">
                  {["#0066FF", "#1A1A2E", "#F5F5F5", "#00D4AA", "#FF6B35"].map((color) => (
                    <div key={color} className="space-y-2 text-center">
                      <div className="mx-auto h-12 w-12 rounded-xl border" style={{ backgroundColor: color }} />
                      <p className="text-[10px] text-muted-foreground font-mono">{color}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border bg-card p-6">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground tracking-wide uppercase">
                  Aspect Ratios
                </div>
                <div className="mt-5 grid grid-cols-4 gap-3">
                  {[
                    { ratio: "1:1", label: "Instagram", h: "h-20" },
                    { ratio: "16:9", label: "Facebook", h: "h-14" },
                    { ratio: "9:16", label: "Stories", h: "h-28" },
                    { ratio: "4:5", label: "IG Feed", h: "h-24" },
                  ].map((item) => (
                    <div key={item.ratio} className="rounded-xl bg-muted/30 p-3 text-center border">
                      <div className={`mx-auto w-full ${item.h} rounded-lg bg-primary/10 flex items-center justify-center`}>
                        <p className="text-sm font-bold text-primary">{item.ratio}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border bg-card p-6">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground tracking-wide uppercase">
                  Visual Styles
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {["Branded", "Photorealistic", "Illustration", "Minimal", "Abstract"].map((style) => (
                    <span key={style} className="rounded-full border px-4 py-2 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground transition cursor-default">
                      {style}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>

            <div className="order-1 lg:order-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary tracking-wide">
                AI Image Generation
              </div>
              <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-3xl">
                Branded visuals, generated in seconds
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Stop searching stock photo libraries. Markaestro creates images that match your brand identity — colors, style, product context — using the most advanced AI image models available.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  { title: "Gemini Imagen 3", desc: "Google's latest image model for photorealistic branded visuals with exceptional detail and coherence." },
                  { title: "DALL-E 3 Fallback", desc: "Automatic fallback to OpenAI's DALL-E 3 ensures you always get results, even during provider outages." },
                  { title: "Brand Identity Integration", desc: "Upload your logo, define your colors, and set visual direction. Every generated image reflects your brand." },
                  { title: "Channel-Ready Outputs", desc: "Images are generated at the exact dimensions each platform requires. No cropping, no resizing, no manual work." },
                ].map((item) => (
                  <li key={item.title} className="flex items-start gap-4">
                    <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How AI Works */}
      <section className="border-t bg-mk-paper border-mk-rule">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mk-eyebrow">Under the Hood</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] leading-[1.1] lg:text-4xl">
              How the AI <span className="text-primary">thinks</span>
            </h2>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { step: "01", title: "Learn Your Brand", desc: "You define your product's voice, tone, visual identity, and target audience. The AI uses this as its creative brief." },
              { step: "02", title: "Generate Content", desc: "Select a channel and format. The AI writes copy that matches your voice profile, optimized for the platform's constraints." },
              { step: "03", title: "Create Visuals", desc: "Choose an aspect ratio and style. The AI generates images using your brand colors and visual direction." },
              { step: "04", title: "Refine & Publish", desc: "Review, regenerate, or tweak. When it's right, publish directly or add to your content calendar." },
            ].map((item) => (
              <div key={item.step} className="rounded-xl border bg-card p-6">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-primary">{item.step}</span>
                </div>
                <h3 className="mt-5 text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
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
              Let AI do the heavy lifting
            </h2>
            <p
              className="mt-4 text-[14px] sm:text-[15px]"
              style={{
                color: "color-mix(in oklch, var(--mk-paper) 70%, transparent)",
              }}
            >
              Define your brand once. Generate unlimited on-brand content — copy and images — in seconds.
            </p>
            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button
                  size="lg"
                  className="h-11 px-7 rounded-lg text-[13.5px]"
                  style={{ background: "var(--mk-paper)", color: "var(--mk-ink)" }}
                >
                  Try AI Studio free
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
