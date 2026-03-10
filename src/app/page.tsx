"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BarChart3,
  Bot,
  ChevronRight,
  Image as ImageIcon,
  Mail,
  Megaphone,
  Send,
  Shield,
  Sparkles,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.5, ease },
  }),
};

export default function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ─── Navbar ─── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg border bg-white p-0.5 shadow-sm">
              <Image src="/markaestro-logo.jpg" alt="Markaestro" width={32} height={32} className="h-full w-full object-contain" />
            </div>
            <span className="text-base font-bold tracking-tight">Markaestro</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition">Features</a>
            <a href="#channels" className="text-sm text-muted-foreground hover:text-foreground transition">Channels</a>
            <a href="#ai" className="text-sm text-muted-foreground hover:text-foreground transition">AI Studio</a>
            <a href="#security" className="text-sm text-muted-foreground hover:text-foreground transition">Security</a>
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
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(0,0,0,0.03),transparent_40%),radial-gradient(circle_at_70%_60%,rgba(0,0,0,0.02),transparent_50%)]" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:py-36">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              AI-Powered Marketing Automation
            </div>
            <h1 className="text-5xl font-normal tracking-tight text-foreground lg:text-7xl lg:leading-[1.1] font-[family-name:var(--font-display)]">
              Your entire marketing engine in one platform
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed lg:text-xl">
              Publish to every channel, launch ad campaigns, generate branded content with AI, and track everything from a single dashboard.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" className="h-12 px-8 text-sm rounded-xl">
                  Start for Free <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button variant="outline" size="lg" className="h-12 px-8 text-sm rounded-xl">
                  See Features
                </Button>
              </a>
            </div>
          </motion.div>

          {/* Hero stats */}
          <motion.div
            className="mx-auto mt-20 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border shadow-sm"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease }}
          >
            {[
              { value: "6+", label: "Channels" },
              { value: "AI", label: "Content & Images" },
              { value: "100%", label: "Automated" },
            ].map((stat) => (
              <div key={stat.label} className="bg-background px-6 py-6 text-center">
                <p className="text-2xl font-bold tracking-tight text-foreground">{stat.value}</p>
                <p className="mt-1 text-xs text-muted-foreground font-medium">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Features Grid ─── */}
      <section id="features" className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Platform</p>
            <h2 className="mt-3 text-3xl font-normal tracking-tight text-foreground lg:text-4xl font-[family-name:var(--font-display)]">
              Everything you need to grow
            </h2>
            <p className="mt-4 text-muted-foreground">
              From first draft to published campaign, Markaestro handles every step of your marketing workflow.
            </p>
          </div>

          <div className="mt-16 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Send,
                title: "Multi-Channel Publishing",
                desc: "Publish to Facebook, Instagram, X, and TikTok from a single composer. Schedule posts or publish instantly.",
              },
              {
                icon: Mail,
                title: "Email Campaigns",
                desc: "Build, segment, and send email campaigns to your contact lists with built-in template support and delivery tracking.",
              },
              {
                icon: Megaphone,
                title: "Ad Campaign Management",
                desc: "Create and launch ad campaigns on Meta and Google Ads with audience targeting, budgets, and creative management.",
              },
              {
                icon: Bot,
                title: "AI Content Generation",
                desc: "Generate on-brand copy powered by your product's brand voice. Multiple tones, formats, and channel-specific optimization.",
              },
              {
                icon: ImageIcon,
                title: "AI Image Generation",
                desc: "Create branded visuals with Gemini Imagen 3 and DALL-E. Auto-matches your brand colors, style, and product identity.",
              },
              {
                icon: Workflow,
                title: "Automations & Scheduling",
                desc: "Set up recurring jobs, drip sequences, and event-triggered workflows. Runs unattended on a configurable schedule.",
              },
              {
                icon: Users,
                title: "Contact Management",
                desc: "Import, tag, and segment your audience. Track engagement and build targeted lists for campaigns and automations.",
              },
              {
                icon: BarChart3,
                title: "Analytics Dashboard",
                desc: "Track opens, clicks, engagement rates, and campaign performance across all channels in real time.",
              },
              {
                icon: Zap,
                title: "OAuth Integrations",
                desc: "One-click connect to Meta, Google, and TikTok via secure OAuth. No manual token management required.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-background p-8 transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:bg-accent-soft hover:translate-x-1 hover:-translate-y-1"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border shadow-sm">
                  <Icon className="h-5 w-5 text-foreground" />
                </div>
                <h3 className="mt-5 text-sm font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Channels ─── */}
      <section id="channels" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Channels</p>
              <h2 className="mt-3 text-3xl font-normal tracking-tight text-foreground lg:text-4xl font-[family-name:var(--font-display)]">
                Reach your audience everywhere
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Connect once and publish to every major platform. Markaestro handles the API differences, character limits, and media requirements for each channel.
              </p>
              <div className="mt-8 space-y-4">
                {[
                  { name: "Facebook & Instagram", desc: "OAuth-connected via Meta. Pages, feed posts, stories, and IG business publishing." },
                  { name: "X (Twitter)", desc: "Text and media posts with hashtag optimization and thread support." },
                  { name: "TikTok", desc: "Photo and video content publishing via TikTok's Content Posting API." },
                  { name: "Email (Resend)", desc: "Transactional and marketing email campaigns with template support." },
                  { name: "Google Ads", desc: "Search and display campaigns with audience targeting and budget management." },
                ].map((ch) => (
                  <div key={ch.name} className="flex items-start gap-3">
                    <ChevronRight className="mt-0.5 h-4 w-4 text-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{ch.name}</p>
                      <p className="text-sm text-muted-foreground">{ch.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border">
              {[
                { label: "Social Channels", value: "4", sub: "Facebook, Instagram, X, TikTok" },
                { label: "Ad Platforms", value: "2", sub: "Meta Ads, Google Ads" },
                { label: "Email Providers", value: "1", sub: "Resend (more coming)" },
                { label: "AI Providers", value: "2", sub: "Gemini Imagen, OpenAI DALL-E" },
              ].map((item) => (
                <div key={item.label} className="bg-background p-6 transition-all duration-300 hover:bg-accent-soft">
                  <p className="text-3xl font-bold tracking-tight text-foreground">{item.value}</p>
                  <p className="mt-1 text-xs font-semibold text-foreground">{item.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── AI Studio ─── */}
      <section id="ai" className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <div className="order-2 lg:order-1">
              <div className="grid gap-px overflow-hidden rounded-xl border bg-border">
                <div className="bg-background p-8">
                  <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                    <Sparkles className="h-4 w-4" /> AI Content Generation
                  </div>
                  <div className="mt-4 space-y-3 font-mono text-xs text-muted-foreground">
                    <div className="rounded-lg border bg-muted/50 p-3">
                      <span className="text-foreground font-semibold">Brand Voice:</span> Professional, confident, results-driven
                    </div>
                    <div className="rounded-lg border bg-muted/50 p-3">
                      <span className="text-foreground font-semibold">Tone:</span> Authoritative yet approachable
                    </div>
                    <div className="rounded-lg border bg-muted/50 p-3">
                      <span className="text-foreground font-semibold">Output:</span> Channel-optimized copy for Facebook, Instagram, X, TikTok, Email
                    </div>
                  </div>
                </div>
                <div className="bg-background p-8">
                  <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                    <ImageIcon className="h-4 w-4" /> AI Image Generation
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-lg border bg-border">
                    {["1:1", "16:9", "9:16", "4:5"].map((ratio) => (
                      <div key={ratio} className="bg-muted/50 p-3 text-center">
                        <p className="text-xs font-semibold text-foreground">{ratio}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {ratio === "1:1" ? "Instagram" : ratio === "16:9" ? "Facebook" : ratio === "9:16" ? "Stories" : "IG Feed"}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">
                    5 styles: Branded, Photorealistic, Illustration, Minimal, Abstract
                  </p>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">AI Studio</p>
              <h2 className="mt-3 text-3xl font-normal tracking-tight text-foreground lg:text-4xl font-[family-name:var(--font-display)]">
                Content that sounds like you
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Train Markaestro on your brand voice, product identity, and visual style. Every piece of content — text and images — is generated to match your brand, not a generic template.
              </p>
              <div className="mt-8 space-y-4">
                {[
                  "Brand voice profiles per product with tone, style, and vocabulary",
                  "Brand identity with logo, colors, and visual direction",
                  "Gemini Imagen 3 for photorealistic branded images",
                  "OpenAI DALL-E 3 fallback for maximum reliability",
                  "Channel-aware formatting: hashtags, char limits, media specs",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <ChevronRight className="mt-0.5 h-4 w-4 text-foreground shrink-0" />
                    <p className="text-sm text-muted-foreground">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Security ─── */}
      <section id="security" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Security</p>
            <h2 className="mt-3 text-3xl font-normal tracking-tight text-foreground lg:text-4xl font-[family-name:var(--font-display)]">
              Enterprise-grade security, zero complexity
            </h2>
            <p className="mt-4 text-muted-foreground">
              Your credentials and data are protected with industry-standard encryption and infrastructure.
            </p>
          </div>

          <div className="mt-16 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Shield,
                title: "AES-256-GCM",
                desc: "All OAuth tokens and API keys are encrypted at rest with AES-256-GCM before storage.",
              },
              {
                icon: Shield,
                title: "Secret Manager",
                desc: "Server credentials stored in Google Cloud Secret Manager. Never in code or config files.",
              },
              {
                icon: Shield,
                title: "Firebase Auth",
                desc: "Passwords handled by Firebase Authentication. We never see or store your password.",
              },
              {
                icon: Shield,
                title: "Google Cloud",
                desc: "Hosted on Cloud Run with automatic scaling, TLS, and Google's infrastructure security.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-background p-8 transition-all duration-300 hover:bg-accent-soft">
                <Icon className="h-5 w-5 text-foreground" />
                <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="border-t border-border bg-foreground text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-normal tracking-tight lg:text-4xl font-[family-name:var(--font-display)]">
              Ready to automate your marketing?
            </h2>
            <p className="mt-4 text-primary-foreground/70">
              Set up in minutes. Connect your channels, train your brand voice, and start publishing.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" variant="secondary" className="h-12 px-8 text-sm rounded-xl">
                  Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/contact">
                <Button size="lg" variant="ghost" className="h-12 px-8 text-sm text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10 rounded-xl">
                  Contact Sales
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-border bg-background">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg border bg-white p-0.5 shadow-sm">
                  <Image src="/markaestro-logo.jpg" alt="Markaestro" width={28} height={28} className="h-full w-full object-contain" />
                </div>
                <span className="text-sm font-bold tracking-tight">Markaestro</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                The premium marketing automation platform for modern teams.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-foreground">Product</p>
              <div className="mt-4 flex flex-col gap-2.5">
                <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition">Features</a>
                <a href="#channels" className="text-sm text-muted-foreground hover:text-foreground transition">Channels</a>
                <a href="#ai" className="text-sm text-muted-foreground hover:text-foreground transition">AI Studio</a>
                <a href="#security" className="text-sm text-muted-foreground hover:text-foreground transition">Security</a>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-foreground">Company</p>
              <div className="mt-4 flex flex-col gap-2.5">
                <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground transition">Contact</Link>
                <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition">Terms of Service</Link>
                <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition">Privacy Policy</Link>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-foreground">Get Started</p>
              <div className="mt-4 flex flex-col gap-2.5">
                <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">Sign In</Link>
                <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">Create Account</Link>
              </div>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center gap-4 border-t border-border pt-8 sm:flex-row sm:justify-between">
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
