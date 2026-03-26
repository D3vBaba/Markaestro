"use client";

import MarketingLayout from "@/components/layout/MarketingLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, BarChart3, Globe, ImageIcon, LayoutDashboard, Lock, Megaphone, Pencil, Zap } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const coreFeatures = [
  {
    icon: Megaphone,
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
    icon: BarChart3,
    title: "Ad Campaign Management",
    description: "Launch paid campaigns on Meta and Google Ads directly from Markaestro. Set audiences, budgets, and creative variants without switching between ad managers.",
    details: [
      "Audience targeting with saved segments",
      "Budget allocation and pacing controls",
      "A/B creative testing",
      "Real-time spend and performance tracking",
    ],
  },
  {
    icon: Pencil,
    title: "AI Content Generation",
    description: "Generate on-brand copy powered by your product's unique voice profile. Choose tone, format, and channel, and Markaestro writes content that sounds like your team wrote it.",
    details: [
      "Brand voice profiles per product",
      "Multiple tone presets (professional, casual, bold, witty)",
      "Channel-specific formatting and hashtags",
      "One-click regeneration and variations",
    ],
  },
  {
    icon: ImageIcon,
    title: "AI Image Generation",
    description: "Create scroll-stopping visuals without a designer. Markaestro integrates Gemini Imagen 3 and DALL-E 3 to generate branded images in every aspect ratio your channels need.",
    details: [
      "Brand colors and visual style baked in",
      "1:1, 16:9, 9:16, and 4:5 aspect ratios",
      "5 visual styles from photorealistic to abstract",
      "Automatic fallback between AI providers",
    ],
  },
  {
    icon: LayoutDashboard,
    title: "Analytics Dashboard",
    description: "See how every campaign, post, and ad performs in one unified view. Track engagement, reach, clicks, and conversions across all connected channels without exporting spreadsheets.",
    details: [
      "Real-time publishing activity charts",
      "Per-channel engagement breakdown",
      "Ad spend vs. return tracking",
      "Export-ready reporting",
    ],
  },
  {
    icon: Lock,
    title: "OAuth Integrations",
    description: "Connect your accounts in one click with industry-standard OAuth. No manual API keys, no token juggling. Markaestro securely stores and refreshes credentials for you.",
    details: [
      "One-click connect for Meta, Google, TikTok",
      "Encrypted token storage at rest",
      "Automatic token refresh",
      "Granular disconnect per platform",
    ],
  },
];

const platformFeatures = [
  {
    icon: Globe,
    title: "Workspace Management",
    description: "Organize brands, clients, or business units into isolated workspaces. Each workspace has its own products, campaigns, integrations, and team members.",
  },
  {
    icon: Zap,
    title: "Automation Workflows",
    description: "Set up recurring campaigns with scheduled triggers, auto-publish rules, and webhook-driven workflows that keep your marketing engine running while you sleep.",
  },
  {
    icon: Lock,
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Platform</p>
            <h1 className="mt-4 text-4xl font-normal tracking-tight lg:text-6xl font-[family-name:var(--font-display)]">
              Everything you need to <span className="text-primary">grow</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              From first draft to published campaign, Markaestro handles every step of your marketing workflow. Six core capabilities, one platform, zero context-switching.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Core Features */}
      <section className="border-t bg-muted/20">
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
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary tracking-wide">
                    <feature.icon className="h-3.5 w-3.5" />
                    {feature.title}
                  </div>
                  <h2 className="mt-6 text-2xl font-normal tracking-tight lg:text-3xl font-[family-name:var(--font-display)]">
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

                <div className="rounded-2xl border border-border/40 bg-background p-10 lg:p-14">
                  <div className="flex items-center justify-center">
                    <div className="rounded-2xl bg-primary/5 p-8">
                      <feature.icon className="h-16 w-16 text-primary" strokeWidth={1.2} />
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Platform</p>
            <h2 className="mt-4 text-3xl font-normal tracking-tight lg:text-4xl font-[family-name:var(--font-display)]">
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
                className="rounded-2xl border border-border/40 bg-background p-8 transition-all duration-300 hover:translate-y-[-3px] hover:shadow-lg"
              >
                <div className="rounded-xl bg-primary/5 p-3 w-fit">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-5 text-sm font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
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
              Ready to see it in action?
            </h2>
            <p className="mt-5 text-white/70">
              Start for free. No credit card required. Connect your first channel in under two minutes.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
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
    </MarketingLayout>
  );
}
