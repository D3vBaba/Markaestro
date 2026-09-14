"use client";

import { useTranslations } from "next-intl";
import {
  Share2,
  CalendarDays,
  Repeat,
  Send,
  Eye,
  BarChart3,
  Terminal,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";

type ProofItem = { value: string; label: string };

const ICONS = [
  Share2, // 7 Channels
  CalendarDays, // 1 Calendar
  Send, // Unlimited posts
  Eye, // Previews
  BarChart3, // Measured analytics
  Terminal, // API & MCP
  Repeat, // Evergreen
];

const SUBTEXTS = [
  "Instagram, TikTok, Threads, LinkedIn, Facebook, Pinterest, and X natively.",
  "Cross-brand overview with month, week, and filtered views.",
  "Queue weeks of multi-channel campaigns without artificial caps.",
  "Pixel-perfect aspect ratios and character checks before shipping.",
  "First-party numbers directly from platform APIs with no vanity guesses.",
  "Scoped keys for Claude Code, Cursor, custom scripts, and webhooks.",
  "Automatically recycle proven winners with performance-decay shutoff.",
];

export default function DayOneBenefits() {
  const t = useTranslations("home");
  const items = t.raw("proof.items") as ProofItem[];
  const label = t("proof.label");

  // Reorder items so the top 3 cards are high-impact foundation pillars (7 Channels, 1 Calendar, Evergreen),
  // and the bottom 4 cards are the execution capabilities (Unlimited, Previews, Analytics, API).
  // items indices:
  // 0: 7 Channels
  // 1: 1 Calendar
  // 2: Unlimited
  // 3: Previews
  // 4: Analytics
  // 5: API
  // 6: Evergreen

  const topRowIndices = [0, 1, 6];
  const bottomRowIndices = [2, 3, 4, 5];

  return (
    <section className="relative border-y border-border bg-gradient-to-b from-card/80 via-card/40 to-background py-20 sm:py-28">
      {/* Subtle background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 flex justify-center overflow-hidden">
        <div className="h-[320px] w-[800px] rounded-full bg-blue-500/5 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* Header */}
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="accent" className="px-3.5 py-1 text-xs font-semibold uppercase tracking-wider">
            {label}
          </Badge>
          <h2 className="m-0 mt-4 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Publishing Tools for Your First Day
          </h2>
          <p className="m-0 mx-auto mt-4 max-w-2xl text-base leading-7 text-mk-ink-80 sm:text-lg">
            Connect your accounts and organize your publishing. Advanced features depend on your chosen plan.
          </p>
        </div>

        {/* 12-Column Grid: 3 Foundation Cards Top (4 cols each), 4 Execution Cards Bottom (3 cols each) */}
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-12">
          {/* Top Row: 3 Highlight Pillars (4 cols each on desktop) */}
          {topRowIndices.map((idx) => {
            const item = items[idx];
            if (!item) return null;
            const IconComponent = ICONS[idx] || CheckCircle2;
            const subtext = SUBTEXTS[idx];

            return (
              <div
                key={item.label}
                className="group relative flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-mk-accent/40 hover:shadow-lg sm:p-7 lg:col-span-4"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="grid size-11 place-items-center rounded-xl bg-mk-accent-soft text-mk-accent transition-colors group-hover:bg-mk-accent group-hover:text-white">
                      <IconComponent className="size-5" />
                    </div>
                    <Badge variant="outline" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {idx === 6 ? "Pro and Business" : "All paid plans"}
                    </Badge>
                  </div>

                  <div className="mt-6">
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                        {item.value}
                      </span>
                    </div>
                    <h3 className="m-0 mt-2 text-lg font-bold tracking-tight text-foreground">
                      {item.label}
                    </h3>
                    <p className="m-0 mt-2.5 text-xs leading-relaxed text-mk-ink-80 sm:text-sm">
                      {subtext}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-1.5 border-t border-border/60 pt-4 text-xs font-semibold text-mk-accent">
                  <CheckCircle2 className="size-3.5 text-mk-pos" />
                  <span>{idx === 6 ? "Available on Pro and Business" : "Ready after connecting your accounts"}</span>
                </div>
              </div>
            );
          })}

          {/* Bottom Row: 4 Capability Cards (3 cols each on desktop) */}
          {bottomRowIndices.map((idx) => {
            const item = items[idx];
            if (!item) return null;
            const IconComponent = ICONS[idx] || CheckCircle2;
            const subtext = SUBTEXTS[idx];

            return (
              <div
                key={item.label}
                className="group relative flex flex-col justify-between rounded-2xl border border-border/90 bg-background/80 p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-mk-accent/40 hover:shadow-md sm:p-6 lg:col-span-3"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="grid size-9 place-items-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-mk-accent-soft group-hover:text-mk-accent">
                      <IconComponent className="size-4" />
                    </div>
                    <span className="text-xs font-bold font-mono text-mk-accent">
                      {item.value}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h4 className="m-0 text-sm font-bold tracking-tight text-foreground">
                      {item.label}
                    </h4>
                    <p className="m-0 mt-2 text-xs leading-relaxed text-muted-foreground">
                      {subtext}
                    </p>
                  </div>
                </div>

                <div className="mt-5 border-t border-border/40 pt-3">
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                    Verified feature
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom micro-CTA */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row text-center">
          <p className="m-0 text-xs font-medium text-muted-foreground">
            Try your chosen plan for 7 days. A payment method is required; cancel before the trial ends to avoid a charge.
          </p>
          <Link
            href="/features"
            className="inline-flex items-center gap-1 text-xs font-semibold text-mk-accent hover:underline underline-offset-4"
          >
            <span>Compare all feature tiers</span>
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
    </section>
  );
}
