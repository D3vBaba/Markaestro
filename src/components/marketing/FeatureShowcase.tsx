"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import {
  Repeat,
  TrendingUp,
  CalendarDays,
  ShieldCheck,
  Layers,
  Bot,
  CheckCircle2,
  ArrowRight,
  Terminal,
} from "lucide-react";
import { ChannelGlyph } from "@/components/app/ChannelGlyph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FeatureKey = "evergreen" | "intelligence" | "calendar" | "brands" | "agents";

interface FeatureTab {
  id: FeatureKey;
  label: string;
  badge: string;
  title: string;
  description: string;
}

const TABS: FeatureTab[] = [
  {
    id: "evergreen",
    label: "Intelligent Evergreen",
    badge: "The Recycler",
    title: "Put Your Best Posts on Safe Autopilot",
    description:
      "Markaestro can recycle eligible posts, rotate approved caption variants, and pause queues when performance declines. Available on Pro and Business.",
  },
  {
    id: "intelligence",
    label: "First-Party Intelligence",
    badge: "Real Platform Data",
    title: "Evidence and Insights from Platform APIs",
    description:
      "No generic AI guessing. Markaestro measures impressions, reach, saves, and clicks directly from each social network to surface what actually worked and when your audience is listening.",
  },
  {
    id: "calendar",
    label: "Omnichannel Calendar",
    badge: "Master View",
    title: "A Unified Schedule for Every Brand",
    description:
      "View upcoming posts across all 7 channels with color-coded badges, drag-and-drop rescheduling, and channel-filtered views that keep multi-brand growth organized.",
  },
  {
    id: "brands",
    label: "Brand Isolation",
    badge: "Agency Ready",
    title: "Every Brand in Its Own Strict Lane",
    description:
      "Clients, side projects, or your personal brand. Each brand maintains its own social tokens, media assets, team roles, and tone of voice with zero risk of cross-posting accidents.",
  },
  {
    id: "agents",
    label: "Agent & MCP Native",
    badge: "Headless Protocol",
    title: "Connect AI Agents Directly to Your Calendar",
    description:
      "Hand scoped API keys to Claude Code, Cursor, or internal scripts. Our Model Context Protocol (MCP) server allows AI agents to discover channels, draft posts, and schedule with human-in-the-loop safety.",
  },
];

export default function FeatureShowcase() {
  const [activeFeature, setActiveFeature] = useState<FeatureKey>("evergreen");

  // Evergreen demo state
  const [activeCycleStep, setActiveCycleStep] = useState<number>(0);

  // Calendar filter state
  const [calendarFilter, setCalendarFilter] = useState<string>("all");

  return (
    <section className="border-t border-border bg-card/50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* Section Header */}
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="accent" className="px-3 py-1 text-xs font-semibold uppercase tracking-wider">
            Engineered for Growth Teams
          </Badge>
          <h2 className="m-0 mt-4 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            See Exactly What Markaestro Does
          </h2>
          <p className="m-0 mx-auto mt-4 max-w-2xl text-base leading-7 text-mk-ink-80 sm:text-lg">
            Explore interactive examples of the publishing workflow. All brands, posts, and performance figures shown here are illustrative.
          </p>
        </div>

        {/* Feature Navigation Pills */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFeature(tab.id)}
              type="button"
              className={cn(
                "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition-all",
                activeFeature === tab.id
                  ? "bg-primary text-primary-foreground shadow-md shadow-blue-500/20"
                  : "bg-background border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {tab.id === "evergreen" && <Repeat className="size-4" />}
              {tab.id === "intelligence" && <TrendingUp className="size-4" />}
              {tab.id === "calendar" && <CalendarDays className="size-4" />}
              {tab.id === "brands" && <Layers className="size-4" />}
              {tab.id === "agents" && <Bot className="size-4" />}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Dynamic Interactive Panel */}
        <div className="mt-10 overflow-hidden rounded-3xl border border-border bg-background shadow-xl">
          <div className="grid gap-0 lg:grid-cols-12">
            {/* Left Narrative Column (5 cols) */}
            <div className="flex flex-col justify-between border-b border-border p-8 lg:col-span-5 lg:border-b-0 lg:border-r">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-mk-accent/30 bg-mk-accent-soft px-3 py-1 text-xs font-bold text-mk-accent">
                  {TABS.find((t) => t.id === activeFeature)?.badge}
                </div>
                <h3 className="m-0 mt-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  {TABS.find((t) => t.id === activeFeature)?.title}
                </h3>
                <p className="m-0 mt-4 text-sm leading-relaxed text-mk-ink-80 sm:text-base">
                  {TABS.find((t) => t.id === activeFeature)?.description}
                </p>

                {/* Feature specific highlights */}
                {activeFeature === "evergreen" && (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Variant Rotation:</strong> Never repost duplicate captions: rotate 3 approved hooks.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Learned Timing:</strong> Slots automatically calculated from follower peak activity.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Performance Decay Safety:</strong> Auto-pauses if consecutive runs lose engagement.</span>
                    </div>
                  </div>
                )}

                {activeFeature === "intelligence" && (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>First-Party Metrics:</strong> Direct API feeds without black-box estimations.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Timing Heatmaps:</strong> Hour-by-hour audience availability for all channels.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Actionable Proof:</strong> Clear attribution data linked to revenue and clicks.</span>
                    </div>
                  </div>
                )}

                {activeFeature === "calendar" && (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>7-Channel Matrix:</strong> Month, week, and list views for high-volume publishing.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Channel Filtering:</strong> Isolate one network or view combined brand schedules.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Drag and Drop:</strong> Move posts effortlessly while preserving optimal timing checks.</span>
                    </div>
                  </div>
                )}

                {activeFeature === "brands" && (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Zero Accidental Cross-Posts:</strong> Scoped channel tokens and separate media vaults.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Distinct Voices:</strong> Custom brand tone, guidelines, and target audiences.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Client and Role Access:</strong> Invite clients or teammates to specific brands only.</span>
                    </div>
                  </div>
                )}

                {activeFeature === "agents" && (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Model Context Protocol:</strong> Local and hosted MCP tools for modern LLM agents.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Manual-First Guardrails:</strong> Meta and TikTok stay review-required unless opted in.</span>
                    </div>
                    <div className="flex items-start gap-2.5 text-xs text-foreground">
                      <CheckCircle2 className="size-4 text-mk-pos mt-0.5 shrink-0" />
                      <span><strong>Connect API Compatibility:</strong> Drop-in endpoint for scheduling clients.</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-border">
                <Button variant="outline" className="w-full justify-between text-xs" asChild>
                  <Link href="/features">
                    <span>Read full technical specifications</span>
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Right Interactive Mockup Column (7 cols) */}
            <div className="bg-muted/30 p-6 sm:p-8 lg:col-span-7 flex flex-col justify-center">
              {/* TAB 1: Intelligent Evergreen */}
              {activeFeature === "evergreen" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex items-center justify-between border-b border-border pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Active Evergreen Pipeline
                          </span>
                          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            Healthy
                          </span>
                        </div>
                        <h4 className="mt-1 text-sm font-bold text-foreground">
                          Ethiopian Single-Origin Roast Spotlight
                        </h4>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ChannelGlyph provider="instagram" size={16} />
                        <ChannelGlyph provider="threads" size={16} />
                        <ChannelGlyph provider="x" size={16} />
                      </div>
                    </div>

                    {/* Cycle Steps Interactive Visualization */}
                    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        { step: "1. Winner", desc: "Top 4% engagement", active: activeCycleStep >= 0 },
                        { step: "2. Variants", desc: "3 hooks approved", active: activeCycleStep >= 1 },
                        { step: "3. Timing", desc: "Friday 14:30 peak", active: activeCycleStep >= 2 },
                        { step: "4. Guardrail", desc: "Decay monitoring", active: activeCycleStep >= 3 },
                      ].map((s, idx) => (
                        <button
                          key={s.step}
                          type="button"
                          onClick={() => setActiveCycleStep(idx)}
                          className={cn(
                            "flex flex-col text-left rounded-xl border p-3 transition-all",
                            activeCycleStep === idx
                              ? "border-mk-accent bg-mk-accent-soft/70 shadow-sm"
                              : "border-border bg-background hover:bg-muted/50"
                          )}
                        >
                          <span className="text-xs font-bold text-foreground">{s.step}</span>
                          <span className="text-[11px] text-muted-foreground mt-1">{s.desc}</span>
                        </button>
                      ))}
                    </div>

                    {/* Detailed Active Step Info */}
                    <div className="mt-4 rounded-xl border border-border bg-background p-4">
                      {activeCycleStep === 0 && (
                        <div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">Original Winner Post Performance</span>
                            <Badge variant="accent">+3.4x Reach</Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-lg bg-muted p-2">
                              <p className="text-sm font-bold text-foreground">14,280</p>
                              <p className="text-[10px] text-muted-foreground">Impressions</p>
                            </div>
                            <div className="rounded-lg bg-muted p-2">
                              <p className="text-sm font-bold text-foreground">5.2%</p>
                              <p className="text-[10px] text-muted-foreground">Save Rate</p>
                            </div>
                            <div className="rounded-lg bg-muted p-2">
                              <p className="text-sm font-bold text-foreground">412</p>
                              <p className="text-[10px] text-muted-foreground">Profile Visits</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeCycleStep === 1 && (
                        <div>
                          <p className="text-xs font-semibold text-foreground">
                            Caption Rotation (Prevents Duplicate Penalty)
                          </p>
                          <div className="mt-2 space-y-2">
                            <div className="rounded-lg border border-border bg-muted/40 p-2 text-xs">
                              <span className="font-bold text-mk-accent">Variant A:</span> &quot;Cold brew season starts Friday. Limited Ethiopian batch roasted in Brooklyn.&quot;
                            </div>
                            <div className="rounded-lg border border-border bg-muted/40 p-2 text-xs">
                              <span className="font-bold text-mk-accent">Variant B:</span> &quot;Behind the bean: how we profile our single-origin Ethiopian roast for iced drinks.&quot;
                            </div>
                          </div>
                        </div>
                      )}

                      {activeCycleStep === 2 && (
                        <div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">Audience-Ready Schedule Window</span>
                            <span className="text-[11px] font-mono text-mk-pos">98.4% Confidence</span>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Next occurrence scheduled for <strong>Friday, October 16 at 14:30 EST</strong> based on audience activity data.
                          </p>
                        </div>
                      )}

                      {activeCycleStep === 3 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="size-4" />
                            <span>Safety Guardrail Enforced</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            If run 3 or run 4 experiences two consecutive dips below 1.5% engagement, Markaestro automatically pauses recycling to protect brand health.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: First-Party Intelligence */}
              {activeFeature === "intelligence" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex items-center justify-between border-b border-border pb-4">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Example Metrics
                        </span>
                        <h4 className="mt-1 text-sm font-bold text-foreground">
                          Audience Engagement Timing Heatmap
                        </h4>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        Last 30 Days
                      </Badge>
                    </div>

                    {/* Mini Heatmap Visualization */}
                    <div className="mt-4">
                      <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5 font-mono">
                        <span>Mon</span>
                        <span>Tue</span>
                        <span>Wed</span>
                        <span>Thu</span>
                        <span>Fri (Peak)</span>
                        <span>Sat</span>
                        <span>Sun</span>
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {[
                          [20, 35, 50, 40, 80, 45, 30],
                          [30, 45, 65, 55, 95, 60, 40],
                          [40, 50, 70, 60, 100, 75, 50],
                          [25, 30, 45, 35, 65, 40, 20],
                        ].map((row, rIdx) => (
                          <div key={rIdx} className="contents">
                            {row.map((val, cIdx) => (
                              <div
                                key={`${rIdx}-${cIdx}`}
                                className={cn(
                                  "h-6 rounded transition-all",
                                  val > 80
                                    ? "bg-mk-accent font-bold"
                                    : val > 50
                                    ? "bg-mk-accent/40"
                                    : "bg-muted"
                                )}
                                title={`Activity level: ${val}%`}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Low Audience Activity</span>
                        <span className="font-bold text-mk-accent">Peak Window (Fri 14:00 - 17:00)</span>
                      </div>
                    </div>

                    {/* Discovered pattern box */}
                    <div className="mt-4 rounded-xl border border-mk-rule bg-mk-panel/60 p-3 text-xs">
                      <span className="font-bold text-foreground">Recommendation:</span> Carousels with behind-the-scenes video clips generate 2.8x higher comment response than static images.
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Omnichannel Calendar */}
              {activeFeature === "calendar" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex items-center justify-between border-b border-border pb-4">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          October 2026 Week 3
                        </span>
                        <h4 className="mt-1 text-sm font-bold text-foreground">
                          Scheduled Across 7 Networks
                        </h4>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setCalendarFilter("all")}
                          className={cn(
                            "rounded px-2 py-1 text-[10px] font-semibold",
                            calendarFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                          )}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => setCalendarFilter("instagram")}
                          className={cn(
                            "rounded px-2 py-1 text-[10px] font-semibold",
                            calendarFilter === "instagram" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                          )}
                        >
                          Instagram
                        </button>
                      </div>
                    </div>

                    {/* Mock Weekly Calendar Grid */}
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-border bg-background p-3">
                        <span className="text-[11px] font-bold text-muted-foreground">Wednesday</span>
                        <div className="mt-2 space-y-2">
                          <div className="rounded-lg border border-mk-rule bg-mk-panel/50 p-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <ChannelGlyph provider="linkedin" size={14} />
                              <span className="font-bold">10:00 AM</span>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground truncate">
                              Engineering update v2
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-background p-3">
                        <span className="text-[11px] font-bold text-muted-foreground">Thursday</span>
                        <div className="mt-2 space-y-2">
                          <div className="rounded-lg border border-pink-200 dark:border-pink-900 bg-pink-50/60 dark:bg-pink-950/20 p-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <ChannelGlyph provider="instagram" size={14} />
                              <span className="font-bold">12:30 PM</span>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground truncate">
                              Studio reel drop
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-background p-3">
                        <span className="text-[11px] font-bold text-mk-accent">Friday (Peak)</span>
                        <div className="mt-2 space-y-2">
                          <div className="rounded-lg border border-mk-accent/40 bg-mk-accent-soft p-2 text-xs">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <ChannelGlyph provider="tiktok" size={14} />
                                <span className="font-bold text-mk-accent">02:30 PM</span>
                              </div>
                              <Repeat className="size-3 text-mk-accent" />
                            </div>
                            <p className="mt-1 text-[11px] font-semibold text-foreground truncate">
                              Ethiopian roast winner
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: Multi-Brand Isolation */}
              {activeFeature === "brands" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Agency Workspace Isolation
                    </span>
                    <h4 className="mt-1 text-sm font-bold text-foreground">
                      Independent Channels, Voice, and Permissions
                    </h4>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-border bg-background p-4">
                        <div className="flex items-center gap-2">
                          <div className="size-3 rounded-full bg-indigo-500" />
                          <span className="text-xs font-bold text-foreground">DripCheckr</span>
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          4 channels connected: Instagram, TikTok, Threads, X. Tone: Energetic streetwear.
                        </p>
                        <div className="mt-3 flex gap-1">
                          <ChannelGlyph provider="instagram" size={14} />
                          <ChannelGlyph provider="tiktok" size={14} />
                          <ChannelGlyph provider="threads" size={14} />
                          <ChannelGlyph provider="x" size={14} />
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-background p-4">
                        <div className="flex items-center gap-2">
                          <div className="size-3 rounded-full bg-blue-600" />
                          <span className="text-xs font-bold text-foreground">FintechDaily</span>
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          3 channels connected: LinkedIn, Threads, X. Tone: Quantitative analytical.
                        </p>
                        <div className="mt-3 flex gap-1">
                          <ChannelGlyph provider="linkedin" size={14} />
                          <ChannelGlyph provider="threads" size={14} />
                          <ChannelGlyph provider="x" size={14} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400 text-xs">
                      <ShieldCheck className="size-4 shrink-0" />
                      <span>Tokens, media libraries, and posts never cross between brands.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: Agent & MCP Native */}
              {activeFeature === "agents" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex items-center justify-between border-b border-border pb-3">
                      <div className="flex items-center gap-2">
                        <Terminal className="size-4 text-mk-accent" />
                        <span className="text-xs font-mono font-bold text-foreground">
                          MCP Tool Execution: publish_post
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        Status: 200 OK
                      </Badge>
                    </div>

                    <pre className="mt-3 overflow-x-auto rounded-xl bg-muted/80 p-3.5 font-mono text-[11px] text-foreground leading-relaxed">
{`{
  "tool": "markaestro_schedule_post",
  "brand_id": "prod_dripcheckr",
  "channels": ["instagram", "tiktok"],
  "caption": "Cold brew season starts Friday.",
  "scheduled_at": "2026-10-16T14:30:00Z",
  "guardrails": {
    "manual_handoff_review": true,
    "decay_auto_pause": true
  }
}`}
                    </pre>

                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Compatible with Claude Code, Cursor, OpenClaw, and custom LLM agent tools.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
