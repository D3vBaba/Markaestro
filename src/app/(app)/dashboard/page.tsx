"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { DashboardOverviewChart } from "@/components/dashboard/OverviewChart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Status } from "@/components/mk/Status";
import { Channel } from "@/components/mk/Channel";
import { channelLabel } from "@/components/mk/channels";
import { fmtCount } from "@/components/mk/format";
import { AlertCircle, ChevronRight, Plus, RefreshCw } from "lucide-react";

type DashboardMetrics = {
  totalProducts: number;
  activeProducts: number;
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  postsByChannel: Record<string, number>;
};

type DailyPost = {
  date: string;
  label: string;
  published: number;
  scheduled: number;
};

type RecentPost = {
  id: string;
  channel: string;
  status: string;
  content: string;
  date: string;
};

type Kpi = {
  key: string;
  label: string;
  value: string;
  sub?: string;
};

type DashboardData = {
  metrics: DashboardMetrics;
  dailyPosts: DailyPost[];
  recentPosts: RecentPost[];
};

export default function Home() {
  const { data, loading, refreshing, error, refresh } =
    useApiQuery<DashboardData>("/api/dashboard");
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);

  const dailyPosts = data?.dailyPosts ?? [];
  const recentPosts = data?.recentPosts ?? [];

  const toggleSeries = (key: string) =>
    setHiddenSeries((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const m = data?.metrics ?? null;
  const publishedTotal = dailyPosts.reduce((a, d) => a + (d.published || 0), 0);

  const kpis: Kpi[] = [
    {
      key: "products",
      label: "Products",
      value: fmtCount(m?.totalProducts ?? 0),
      sub: `${m?.activeProducts ?? 0} active`,
    },
    {
      key: "posts",
      label: "Posts",
      value: fmtCount(m?.totalPosts ?? 0),
      sub: `${m?.publishedPosts ?? 0} published · ${m?.scheduledPosts ?? 0} scheduled`,
    },
    {
      key: "week",
      label: "Published · 7d",
      value: fmtCount(publishedTotal),
      sub: `across ${dailyPosts.length} days`,
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        subtitle="Your marketing engine at a glance."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-lg h-9 text-[13px] gap-1.5"
              onClick={() => refresh()}
              disabled={loading || refreshing}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <Link href="/content">
              <Button className="rounded-lg h-9 text-[13px] gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                New post
              </Button>
            </Link>
          </div>
        }
      />

      {error && !loading && (
        <div
          className="flex items-start gap-3 rounded-xl p-4 mb-4 sm:mb-5"
          style={{
            background:
              "color-mix(in oklch, var(--mk-neg) 6%, var(--mk-paper))",
            border:
              "1px solid color-mix(in oklch, var(--mk-neg) 30%, var(--mk-rule))",
          }}
        >
          <AlertCircle
            className="h-4 w-4 mt-0.5 shrink-0"
            style={{ color: "var(--mk-neg)" }}
          />
          <div className="flex-1 min-w-0">
            <p
              className="text-[13px] font-medium m-0"
              style={{ color: "var(--mk-ink)" }}
            >
              Couldn&apos;t load your dashboard
            </p>
            <p
              className="text-[12px] mt-0.5 m-0"
              style={{ color: "var(--mk-ink-60)" }}
            >
              We couldn&apos;t load your dashboard data.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg text-[12px] shrink-0"
            onClick={() => refresh()}
          >
            Retry
          </Button>
        </div>
      )}

      {!(error && !loading) && (
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left column */}
        <div className="flex flex-col gap-4 sm:gap-5 min-w-0">
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
            {kpis.map((k) => (
              <div
                key={k.key}
                className="rounded-xl p-3 sm:p-4"
                style={{
                  background: "var(--mk-paper)",
                  border: "1px solid var(--mk-rule)",
                }}
              >
                <div className="mk-eyebrow">{k.label}</div>
                {loading ? (
                  <>
                    <Skeleton className="mt-2 sm:mt-2.5 h-7 sm:h-8 w-16" />
                    <Skeleton className="mt-1.5 h-3 w-24" />
                  </>
                ) : (
                  <>
                    <div
                      className="mt-1.5 sm:mt-2 text-[22px] sm:text-[26px] font-semibold mk-figure"
                      style={{ color: "var(--mk-ink)" }}
                    >
                      {k.value}
                    </div>
                    {k.sub && (
                      <div
                        className="mt-1 text-[10.5px] sm:text-[11px] font-mono truncate"
                        style={{ color: "var(--mk-ink-40)", letterSpacing: "0.04em" }}
                      >
                        {k.sub}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Chart card */}
          <div
            className="rounded-xl p-4 sm:p-5"
            style={{
              background: "var(--mk-paper)",
              border: "1px solid var(--mk-rule)",
            }}
          >
            <div className="flex items-start justify-between mb-3.5 gap-3 flex-wrap">
              <div>
                <div className="mk-eyebrow">Publishing activity · 7d</div>
                {loading ? (
                  <Skeleton className="mt-1.5 h-6 w-44" />
                ) : (
                  <div
                    className="mt-1 text-[18px] font-semibold"
                    style={{ color: "var(--mk-ink)", letterSpacing: "-0.02em" }}
                  >
                    {fmtCount(publishedTotal)} published this week
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                {[
                  { key: "published", label: "Published", color: "var(--mk-ink)" },
                  { key: "scheduled", label: "Scheduled", color: "var(--mk-accent)" },
                ].map((s) => {
                  const hidden = hiddenSeries.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => toggleSeries(s.key)}
                      aria-pressed={!hidden}
                      title={hidden ? `Show ${s.label}` : `Hide ${s.label}`}
                      className={`inline-flex items-center gap-1.5 text-[11px] cursor-pointer transition-opacity ${
                        hidden ? "opacity-40 line-through" : "hover:opacity-80"
                      }`}
                      style={{ color: "var(--mk-ink-60)" }}
                    >
                      <span
                        className="inline-block rounded-[2px]"
                        style={{
                          width: 10,
                          height: 10,
                          background: hidden ? "var(--mk-ink-20)" : s.color,
                        }}
                      />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {loading ? (
              <Skeleton className="w-full rounded-lg" style={{ height: 240 }} />
            ) : (
              <DashboardOverviewChart
                data={dailyPosts}
                height={240}
                hiddenSeries={hiddenSeries}
              />
            )}
          </div>

          {/* Posts by channel */}
          {m?.postsByChannel && Object.keys(m.postsByChannel).length > 0 && (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: "var(--mk-paper)",
                border: "1px solid var(--mk-rule)",
              }}
            >
              <div
                className="px-4 sm:px-5 py-3 sm:py-3.5 border-b"
                style={{ borderColor: "var(--mk-rule)" }}
              >
                <div className="mk-eyebrow">Distribution</div>
                <div
                  className="mt-1 text-[15px] sm:text-[16px] font-semibold"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.02em" }}
                >
                  Posts by channel
                </div>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--mk-rule-soft)" }}>
                {Object.entries(m.postsByChannel)
                  .sort((a, b) => b[1] - a[1])
                  .map(([ch, count], i, arr) => {
                    const total = arr.reduce((a, [, v]) => a + v, 0) || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <Link
                        key={ch}
                        href={`/calendar?channel=${encodeURIComponent(ch)}`}
                        title={`View ${channelLabel(ch)} posts in calendar`}
                        className="group flex items-center gap-3 px-4 sm:px-5 py-3 transition-colors hover:bg-muted/40"
                      >
                        <Channel channel={ch} size={22} />
                        <span
                          className="flex-1 text-[13px]"
                          style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                        >
                          {channelLabel(ch)}
                        </span>
                        <span
                          className="font-mono text-[12px]"
                          style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.01em" }}
                        >
                          {pct}%
                        </span>
                        <span
                          className="font-mono text-[13px] mk-figure text-right w-10"
                          style={{ color: "var(--mk-ink)" }}
                        >
                          {fmtCount(count)}
                        </span>
                        <ChevronRight
                          className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: "var(--mk-ink-40)" }}
                        />
                      </Link>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4 min-w-0">
          <div
            className="rounded-xl p-4"
            style={{
              background: "var(--mk-paper)",
              border: "1px solid var(--mk-rule)",
            }}
          >
            <div className="flex items-end justify-between mb-3">
              <div>
                <div className="mk-eyebrow">Up next</div>
                <h3
                  className="mt-1 text-[16px] font-semibold m-0"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.02em" }}
                >
                  Recent posts
                </h3>
              </div>
              <Link
                href="/calendar"
                className="text-[12px] font-medium hover:underline underline-offset-2"
                style={{ color: "var(--mk-ink-60)" }}
              >
                View all →
              </Link>
            </div>

            {loading ? (
              <div className="flex flex-col gap-3.5 py-1">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <Skeleton className="h-4 w-4 rounded-full mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Skeleton className="h-3.5 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentPosts.length > 0 ? (
              <div className="flex flex-col max-h-105 overflow-y-auto">
                {recentPosts.map((post, i) => (
                  <Link
                    key={post.id}
                    href={`/content/${post.id}`}
                    className="flex items-start gap-2.5 py-2.5"
                    style={{
                      borderTop: i === 0 ? "none" : "1px solid var(--mk-rule-soft)",
                    }}
                  >
                    <div className="pt-0.5">
                      <Channel channel={post.channel} size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[12.5px] font-medium line-clamp-2"
                        style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                      >
                        {post.content || "Untitled post"}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Status value={post.status} />
                        {post.date && (
                          <span
                            className="font-mono text-[9.5px]"
                            style={{ color: "var(--mk-ink-40)", letterSpacing: "0.08em" }}
                          >
                            {new Date(post.date).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div
                className="py-8 text-center text-[13px]"
                style={{ color: "var(--mk-ink-60)" }}
              >
                No posts yet. Create your first to see activity here.
              </div>
            )}

            <Link href="/content" className="block mt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full rounded-lg text-[12px] gap-1.5"
              >
                <Plus className="h-3 w-3" />
                New post
              </Button>
            </Link>
          </div>
        </div>
      </div>
      )}
    </AppShell>
  );
}
