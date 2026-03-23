"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ─── Navbar ─── */}
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary p-1.5">
              <Image src="/markaestro-logo.jpg" alt="Markaestro" width={32} height={32} className="h-full w-full object-contain rounded-md" />
            </div>
            <span className="text-base font-bold tracking-tight">Markaestro</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition">Features</a>
            <a href="#channels" className="text-sm text-muted-foreground hover:text-foreground transition">Channels</a>
            <a href="#ai" className="text-sm text-muted-foreground hover:text-foreground transition">AI Studio</a>
          </nav>

          <div className="flex items-center gap-3">
            {user ? (
              <Link href="/dashboard">
                <Button>Go to Dashboard <ArrowRight className="ml-1.5 h-4 w-4" /></Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" className="text-sm">Sign In</Button>
                </Link>
                <Link href="/login">
                  <Button className="text-sm">Get Started <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

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
              Publish to every channel, launch ad campaigns, generate branded content with AI, and track everything from a single dashboard.
            </p>
            <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" className="h-13 px-10 text-sm rounded-2xl">
                  Start for Free <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button variant="outline" size="lg" className="h-13 px-10 text-sm rounded-2xl">
                  See Features
                </Button>
              </a>
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
              { value: "6+", label: "Channels" },
              { value: "AI", label: "Content & Images" },
              { value: "100%", label: "Automated" },
            ].map((stat) => (
              <div key={stat.label} className="bg-background px-6 py-8 text-center">
                <p className="text-3xl font-bold tracking-tight text-primary">{stat.value}</p>
                <p className="mt-2 text-xs text-muted-foreground font-medium tracking-wide uppercase">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Features Grid ─── */}
      <section id="features" className="border-t bg-muted/20">
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
              {
                title: "Multi-Channel Publishing",
                desc: "Publish to Facebook, Instagram, X, and TikTok from a single composer. Schedule posts or publish instantly.",
              },
              {
                title: "Email Campaigns",
                desc: "Build, segment, and send email campaigns to your contact lists with built-in template support and delivery tracking.",
              },
              {
                title: "Ad Campaign Management",
                desc: "Create and launch ad campaigns on Meta and Google Ads with audience targeting, budgets, and creative management.",
              },
              {
                title: "AI Content Generation",
                desc: "Generate on-brand copy powered by your product's brand voice. Multiple tones, formats, and channel-specific optimization.",
              },
              {
                title: "AI Image Generation",
                desc: "Create branded visuals with Gemini Imagen 3 and DALL-E. Auto-matches your brand colors, style, and product identity.",
              },
              {
                title: "Automations & Scheduling",
                desc: "Set up recurring jobs, drip sequences, and event-triggered workflows. Runs unattended on a configurable schedule.",
              },
              {
                title: "Contact Management",
                desc: "Import, tag, and segment your audience. Track engagement and build targeted lists for campaigns and automations.",
              },
              {
                title: "Analytics Dashboard",
                desc: "Track opens, clicks, engagement rates, and campaign performance across all channels in real time.",
              },
              {
                title: "OAuth Integrations",
                desc: "One-click connect to Meta, Google, and TikTok via secure OAuth. No manual token management required.",
              },
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
        </div>
      </section>

      {/* ─── Channels ─── */}
      <section id="channels" className="border-t">
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
                  { name: "X (Twitter)", desc: "Text and media posts with hashtag optimization and thread support." },
                  { name: "TikTok", desc: "Photo and video content publishing via TikTok's Content Posting API." },
                  { name: "Email (Resend)", desc: "Transactional and marketing email campaigns with template support." },
                  { name: "Google Ads", desc: "Search and display campaigns with audience targeting and budget management." },
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Social Channels", value: "4", sub: "Facebook, Instagram, X, TikTok" },
                { label: "Ad Platforms", value: "2", sub: "Meta Ads, Google Ads" },
                { label: "Email Providers", value: "1", sub: "Resend (more coming)" },
                { label: "AI Providers", value: "2", sub: "Gemini Imagen, OpenAI DALL-E" },
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

      {/* ─── AI Studio ─── */}
      <section id="ai" className="border-t bg-muted/20">
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
                      <span className="text-foreground font-semibold">Output:</span> Channel-optimized copy for Facebook, Instagram, X, TikTok, Email
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border bg-background p-8">
                  <div className="flex items-center gap-2 text-xs font-semibold text-primary tracking-wide uppercase">
                    <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
                    AI Image Generation
                  </div>
                  <div className="mt-5 grid grid-cols-4 gap-3">
                    {["1:1", "16:9", "9:16", "4:5"].map((ratio) => (
                      <div key={ratio} className="rounded-xl bg-muted/30 p-3 text-center border">
                        <p className="text-sm font-bold text-primary">{ratio}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {ratio === "1:1" ? "Instagram" : ratio === "16:9" ? "Facebook" : ratio === "9:16" ? "Stories" : "IG Feed"}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-5 text-xs text-muted-foreground">
                    5 styles: Branded, Photorealistic, Illustration, Minimal, Abstract
                  </p>
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
                  "Brand identity with logo, colors, and visual direction",
                  "Gemini Imagen 3 for photorealistic branded images",
                  "OpenAI DALL-E 3 fallback for maximum reliability",
                  "Channel-aware formatting: hashtags, char limits, media specs",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-4">
                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    <p className="text-sm text-muted-foreground">{item}</p>
                  </div>
                ))}
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
                  Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
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

      {/* ─── Footer ─── */}
      <footer className="border-t bg-background">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary p-1">
                  <Image src="/markaestro-logo.jpg" alt="Markaestro" width={28} height={28} className="h-full w-full object-contain rounded-md" />
                </div>
                <span className="text-sm font-bold tracking-tight">Markaestro</span>
              </div>
              <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
                The premium marketing automation platform for modern teams.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Product</p>
              <div className="mt-5 flex flex-col gap-3">
                <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition">Features</a>
                <a href="#channels" className="text-sm text-muted-foreground hover:text-foreground transition">Channels</a>
                <a href="#ai" className="text-sm text-muted-foreground hover:text-foreground transition">AI Studio</a>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Company</p>
              <div className="mt-5 flex flex-col gap-3">
                <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground transition">Contact</Link>
                <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition">Terms of Service</Link>
                <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition">Privacy Policy</Link>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Get Started</p>
              <div className="mt-5 flex flex-col gap-3">
                <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">Sign In</Link>
                <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">Create Account</Link>
              </div>
            </div>
          </div>

          <div className="mt-16 flex flex-col items-center gap-4 border-t pt-8 sm:flex-row sm:justify-between">
            <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Markaestro. All rights reserved.</p>
            <div className="flex gap-6">
              <Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition">Terms</Link>
              <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition">Privacy</Link>
              <Link href="/contact" className="text-xs text-muted-foreground hover:text-foreground transition">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
