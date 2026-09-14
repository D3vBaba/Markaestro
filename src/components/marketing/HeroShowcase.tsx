"use client";

import NextLink from "next/link";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  Clock3,
  Repeat,
  ShieldCheck,
  TrendingUp,
  CheckCircle2,
  Image as ImageIcon,
  Heart,
  MessageCircle,
  Bookmark,
  ChevronDown,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import { ChannelGlyph } from "@/components/app/ChannelGlyph";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Brand = {
  id: string;
  name: string;
  category: string;
  avatarBg: string;
  channels: ("instagram" | "meta" | "tiktok" | "threads" | "linkedin" | "x" | "pinterest")[];
  postText: string;
  mediaName: string;
  mediaDim: string;
  bestTime: string;
  bestDay: string;
  reachMultiplier: string;
  insight: string;
  variantsCount: number;
};

const BRANDS: Brand[] = [
  {
    id: "dripcheckr",
    name: "DripCheckr",
    category: "D2C Apparel",
    avatarBg: "bg-gradient-to-br from-indigo-500 to-purple-600",
    channels: ["instagram", "tiktok", "threads", "x"],
    postText: "Cold brew drop is live. Limited batch of Ethiopian single-origin, roasted yesterday in Brooklyn. Tap the link in bio before this batch sells out.",
    mediaName: "cold-brew-batch-01.jpg",
    mediaDim: "1080 × 1350 · 4:5 Portrait",
    bestTime: "14:30 EST",
    bestDay: "Friday",
    reachMultiplier: "3.4x",
    insight: "Product specification carousels generate 4.8% save rate (+180% vs account average).",
    variantsCount: 3,
  },
  {
    id: "aura",
    name: "Aura Studio",
    category: "Wellness & Studio",
    avatarBg: "bg-gradient-to-br from-emerald-500 to-teal-600",
    channels: ["instagram", "pinterest", "meta", "tiktok"],
    postText: "Morning light in the studio. Our new 4-week sound bath residency starts next Monday. Reserve your mat before spots fill up.",
    mediaName: "studio-morning-light.mp4",
    mediaDim: "1080 × 1920 · 9:16 Reel",
    bestTime: "08:15 EST",
    bestDay: "Sunday",
    reachMultiplier: "2.9x",
    insight: "Sunday morning video reels produce 3.2x more shares and bookmark saves.",
    variantsCount: 3,
  },
  {
    id: "fintechdaily",
    name: "FintechDaily",
    category: "Financial Media",
    avatarBg: "bg-gradient-to-br from-blue-600 to-cyan-600",
    channels: ["linkedin", "threads", "x"],
    postText: "Why agentic workflows are replacing manual SaaS billing dashboards: a breakdown of 14 platform architectures published this morning.",
    mediaName: "architecture-breakdown.png",
    mediaDim: "1200 × 627 · 1.91:1 Landscape",
    bestTime: "11:00 EST",
    bestDay: "Tuesday",
    reachMultiplier: "4.1x",
    insight: "Technical architecture breakdowns outperform market updates by 4.1x impressions.",
    variantsCount: 4,
  },
];

type ChannelTab = "instagram" | "tiktok" | "linkedin" | "x";

export default function HeroShowcase() {
  const [selectedBrand, setSelectedBrand] = useState<Brand>(BRANDS[0]);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ChannelTab>("instagram");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([
    "instagram",
    "tiktok",
    "threads",
    "linkedin",
  ]);
  const [isEvergreenActive, setIsEvergreenActive] = useState(true);

  const toggleChannel = (channel: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  };

  return (
    <div className="relative mx-auto mt-12 w-full max-w-6xl">
      <p className="mb-3 text-center text-xs text-muted-foreground">Interactive product demo. Brands, posts, and performance figures are illustrative.</p>
      {/* Decorative Glow */}
      <div className="pointer-events-none absolute -inset-1.5 -z-10 rounded-[28px] bg-gradient-to-r from-blue-600/15 via-indigo-500/10 to-blue-400/15 blur-2xl" />

      {/* Main Container */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl shadow-blue-950/10">
        {/* Window Chrome / Title Bar */}
        <div className="flex h-12 items-center justify-between border-b border-border bg-muted/40 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-rose-400/80" />
            <span className="size-3 rounded-full bg-amber-400/80" />
            <span className="size-3 rounded-full bg-emerald-400/80" />
            <span className="ms-2 hidden text-xs font-mono text-muted-foreground sm:inline-block">
              markaestro.app / {selectedBrand.id} / composer
            </span>
          </div>

          {/* Interactive Brand Selector */}
          <div className="relative">
            <button
              onClick={() => setBrandMenuOpen(!brandMenuOpen)}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus:outline-none"
              type="button"
            >
              <div className={cn("size-3.5 rounded-full text-white", selectedBrand.avatarBg)} />
              <span className="font-semibold">{selectedBrand.name}</span>
              <span className="hidden text-muted-foreground sm:inline">({selectedBrand.category})</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>

            {brandMenuOpen && (
              <div className="absolute right-0 top-9 z-30 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-xl">
                <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                  Switch Active Brand
                </div>
                {BRANDS.map((brand) => (
                  <button
                    key={brand.id}
                    onClick={() => {
                      setSelectedBrand(brand);
                      setBrandMenuOpen(false);
                      if (brand.id === "fintechdaily") setActiveTab("linkedin");
                      else setActiveTab("instagram");
                    }}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                      brand.id === selectedBrand.id
                        ? "bg-mk-accent-soft font-semibold text-mk-accent"
                        : "text-foreground hover:bg-muted"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn("size-3.5 rounded-full", brand.avatarBg)} />
                      <span>{brand.name}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{brand.category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status Badge */}
          <div className="hidden items-center gap-2 lg:flex">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">
              Example connected channels
            </span>
          </div>
        </div>

        {/* Studio Body: Split View */}
        <div className="grid gap-0 lg:grid-cols-12">
          {/* Left / Center: Interactive Composer & Native Preview (7 cols) */}
          <div className="flex flex-col border-b border-border p-5 sm:p-6 lg:col-span-7 lg:border-b-0 lg:border-r">
            {/* Channel Targeting Bar */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Publishing Targets ({selectedChannels.length} Active)
                </label>
                <span className="text-[11px] text-muted-foreground">Click to toggle channels</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {(["instagram", "tiktok", "threads", "linkedin", "x", "meta", "pinterest"] as const).map(
                  (ch) => {
                    const isSelected = selectedChannels.includes(ch);
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => toggleChannel(ch)}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
                          isSelected
                            ? "border-mk-accent/40 bg-mk-accent-soft/70 text-foreground ring-1 ring-mk-accent/30"
                            : "border-border bg-background text-muted-foreground opacity-60 hover:opacity-100"
                        )}
                      >
                        <ChannelGlyph provider={ch} size={18} />
                        <span className="capitalize">{ch === "meta" ? "Facebook" : ch}</span>
                        {isSelected && <CheckCircle2 className="size-3 text-mk-accent" />}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Composer Input Box */}
            <div className="mt-5 rounded-xl border border-border bg-background p-4 shadow-inner">
              <div className="flex items-center justify-between pb-2 border-b border-border/50 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">Draft Caption</span>
                <span>{selectedBrand.postText.length} / 2,200 chars</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-foreground min-h-[56px]">
                {selectedBrand.postText}
              </p>

              {/* Media Asset Preview Attachment */}
              <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-muted/50 p-2.5">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-md bg-mk-accent-soft text-mk-accent">
                    <ImageIcon className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{selectedBrand.mediaName}</p>
                    <p className="text-[10px] text-muted-foreground">{selectedBrand.mediaDim}</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono">
                  Asset Verified
                </Badge>
              </div>
            </div>

            {/* Native Preview Section with Platform Viewport */}
            <div className="mt-5 flex-1 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Native Platform Preview</span>
                <div className="flex gap-1 rounded-lg border border-border bg-background p-0.5">
                  {(["instagram", "tiktok", "linkedin", "x"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      type="button"
                      className={cn(
                        "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                        activeTab === tab
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tab === "x" ? "X / Twitter" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Native Preview Card */}
              <div className="mt-3 rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className={cn("size-7 rounded-full", selectedBrand.avatarBg)} />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-foreground">
                        {selectedBrand.name.toLowerCase()}
                      </span>
                      <ChannelGlyph provider={activeTab} size={13} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">Sponsored or Organic</span>
                  </div>
                </div>

                <p className="mt-2.5 text-xs leading-relaxed text-foreground">
                  {selectedBrand.postText}
                </p>

                {/* Platform Styled Media Dummy */}
                <div className="mt-3 flex h-32 w-full items-center justify-center rounded-lg bg-gradient-to-br from-muted via-muted/70 to-card border border-border/80">
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <ChannelGlyph provider={activeTab} size={28} />
                    <span className="text-[11px] font-medium">Native {activeTab} Viewport</span>
                  </div>
                </div>

                {/* Social Interaction Buttons */}
                <div className="mt-3 flex items-center justify-between text-muted-foreground">
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 hover:text-rose-500">
                      <Heart className="size-3.5" /> 1.2k
                    </span>
                    <span className="flex items-center gap-1 hover:text-blue-500">
                      <MessageCircle className="size-3.5" /> 84
                    </span>
                    <span className="flex items-center gap-1 hover:text-emerald-500">
                      <Bookmark className="size-3.5" /> 312
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    Auto-optimized
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: First-Party Intelligence & Evergreen Recycler (5 cols) */}
          <div className="flex flex-col justify-between bg-card/60 p-5 sm:p-6 lg:col-span-5">
            <div className="space-y-4">
              {/* Intelligence Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid size-6 place-items-center rounded-md bg-mk-accent text-white">
                    <TrendingUp className="size-3.5" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                    First-Party Intelligence
                  </span>
                </div>
                <Badge variant="accent" className="text-[10px]">
                  Example Data
                </Badge>
              </div>

              {/* Learned Peak Timing Card */}
              <div className="rounded-xl border border-mk-rule bg-mk-panel/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Clock3 className="size-3.5 text-mk-accent" />
                    Audience Ready Window
                  </span>
                  <span className="rounded-md bg-mk-accent/15 px-2 py-0.5 text-[11px] font-bold text-mk-accent">
                    {selectedBrand.reachMultiplier} Avg Reach
                  </span>
                </div>
                <p className="mt-2 text-base font-bold text-foreground">
                  {selectedBrand.bestDay} at {selectedBrand.bestTime}
                </p>
                <p className="mt-1 text-xs text-mk-ink-80">
                  Calculated from 90 days of your brand historical follower activity.
                </p>
              </div>

              {/* Discovered Performance Pattern */}
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Layers className="size-3.5 text-mk-pos" />
                  Proven Pattern Discovered
                </div>
                <p className="mt-2 text-xs leading-relaxed text-mk-ink-80">
                  {selectedBrand.insight}
                </p>
              </div>

              {/* Intelligent Evergreen Queues Box */}
              <div className="rounded-xl border border-border bg-gradient-to-b from-card to-muted/30 p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Repeat className="size-4 text-mk-accent" />
                    <div>
                      <p className="text-xs font-bold text-foreground">Intelligent Evergreen Queue</p>
                      <p className="text-[10px] text-muted-foreground">Recycle winners safely</p>
                    </div>
                  </div>
                  {/* Toggle button */}
                  <button
                    type="button"
                    aria-label="Toggle example evergreen queue"
                    onClick={() => setIsEvergreenActive(!isEvergreenActive)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      isEvergreenActive ? "bg-mk-accent" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block size-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out",
                        isEvergreenActive ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>

                {isEvergreenActive && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-3 space-y-2 border-t border-border/60 pt-3 text-[11px]"
                  >
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Variant Rotation</span>
                      <span className="font-semibold text-foreground">
                        {selectedBrand.variantsCount} Approved Hooks
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Recycling Cadence</span>
                      <span className="font-semibold text-foreground">Every 28 Days</span>
                    </div>
                    <div className="flex items-start gap-1.5 rounded-lg bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="size-3.5 shrink-0 mt-0.5" />
                      <span className="text-[10px] leading-tight">
                        <strong>Performance Decay Guard:</strong> Auto-pauses if consecutive runs drop below baseline engagement.
                      </span>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            {/* Bottom Actions Bar */}
            <div className="mt-6 flex flex-col gap-2.5 pt-4 border-t border-border">
              <div className="flex gap-2">
                <NextLink
                  href="/onboarding"
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all"
                >
                  <Calendar className="size-3.5" />
                  Try scheduling in your workspace
                </NextLink>
                <NextLink
                  href="/developers/agents"
                  className="flex items-center justify-center rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  title="Learn about API keys for AI agents"
                  aria-label="Learn about API keys for AI agents"
                >
                  <ArrowUpRight className="size-3.5" />
                </NextLink>
              </div>
              <p className="text-center text-[10px] text-muted-foreground">
                One-click schedule or delegate via MCP and Public REST API
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
