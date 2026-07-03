"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { apiDownload } from "@/lib/api-client";
import { KpiCard } from "@/components/analytics/KpiCard";
import { TrendChart, FollowerTrendChart } from "@/components/analytics/TrendChart";
import { BestTimeHeatmap } from "@/components/analytics/BestTimeHeatmap";
import { LeaderboardTable } from "@/components/analytics/LeaderboardTable";
import { ContentTypeBars } from "@/components/analytics/ContentTypeBars";
import { ChannelTable } from "@/components/analytics/ChannelTable";
import { channelLabel } from "@/components/mk/channels";
import { fmtCount } from "@/components/mk/format";
import type { AnalyticsResponse } from "@/lib/analytics/api-shape";
import type { SocialChannel } from "@/lib/schemas";
import { AlertCircle, Download, Lightbulb, Lock, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const RANGE_PRESETS = [
  { days: 7, label: "7d" },
  { days: 28, label: "28d" },
  { days: 90, label: "90d" },
  { days: 365, label: "12m" },
];

const TREND_METRICS = [
  { key: "views", label: "Views" },
  { key: "reach", label: "Reach" },
  { key: "engagements", label: "Engagement" },
  { key: "posts", label: "Posts" },
] as const;

function pctChange(current: number | null, prior: number | null | undefined): number | null {
  if (current === null || prior === null || prior === undefined || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

function Card({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-4 sm:p-5 min-w-0"
      style={{ background: "var(--mk-paper)", border: "1px solid var(--mk-rule)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-3.5 flex-wrap">
        <div>
          <div className="mk-eyebrow">{eyebrow}</div>
          {title && (
            <div
              className="mt-1 text-[16px] font-semibold"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.02em" }}
            >
              {title}
            </div>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(28);
  const [channel, setChannel] = useState<SocialChannel | undefined>(undefined);
  const [productId, setProductId] = useState<string>("");
  const [trendMetric, setTrendMetric] = useState<(typeof TREND_METRICS)[number]["key"]>("views");
  const [exporting, setExporting] = useState(false);

  const { data: productsData } = useApiQuery<{ products: Array<{ id: string; name: string }> }>(
    "/api/products",
  );
  const products = productsData?.products ?? [];

  const { canAccess, getLimit } = useSubscription();
  const maxDays = getLimit("analyticsWindowDays");
  const canExport = canAccess("analyticsCsvExport");

  // Land on the widest range the plan allows instead of a locked preset.
  useEffect(() => {
    if (maxDays !== -1 && days > maxDays) {
      const widest = [...RANGE_PRESETS].reverse().find((p) => p.days <= maxDays);
      setDays(widest?.days ?? maxDays);
    }
  }, [maxDays, days]);

  const tz = useMemo(() => -new Date().getTimezoneOffset(), []);
  const filterParams = `${channel ? `&channel=${channel}` : ""}${productId ? `&productId=${encodeURIComponent(productId)}` : ""}`;
  const path = `/api/analytics?days=${days}&tz=${tz}${filterParams}`;
  const { data, loading, refreshing, error, refresh } = useApiQuery<AnalyticsResponse>(path);

  const clamped = data && data.window.days < data.window.requestedDays;
  const noPostsAtAll = data && !loading && !channel && !productId
    && data.totals.posts === 0 && data.coverage.postsAnalyzed === 0
    && data.followerTrend.length === 0;
  const warmingUp = data && !loading && !noPostsAtAll
    && data.coverage.postsAnalyzed > 0 && data.coverage.postsWithMetrics === 0;

  const followerSpark = data?.followerTrend.map((p) => p.total) ?? [];

  async function handleExport() {
    setExporting(true);
    try {
      const res = await apiDownload(`/api/analytics/export?days=${Math.min(days, 730)}${filterParams}`);
      if (!res.ok || !res.blob) {
        toast.error("Export failed. Please try again.");
        return;
      }
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `markaestro-analytics-${days}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Analytics"
        subtitle="What your posts earned — measured from each platform's own data."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-lg h-9 text-[13px] gap-1.5"
              onClick={() => refresh()}
              disabled={loading || refreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            {canExport ? (
              <Button
                variant="outline"
                className="rounded-lg h-9 text-[13px] gap-1.5"
                onClick={handleExport}
                disabled={exporting || loading}
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? "Exporting…" : "Export CSV"}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="rounded-lg h-9 text-[13px] gap-1.5 opacity-60"
                disabled
                title="CSV export is included in the Business plan"
              >
                <Lock className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            )}
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-4 sm:mb-5">
        <div
          className="inline-flex rounded-lg overflow-hidden"
          style={{ border: "1px solid var(--mk-rule)" }}
        >
          {RANGE_PRESETS.map((preset) => {
            const locked = maxDays !== -1 && preset.days > maxDays;
            const active = days === preset.days;
            return (
              <button
                key={preset.days}
                type="button"
                disabled={locked}
                onClick={() => setDays(preset.days)}
                title={locked ? `The ${preset.label} window requires a higher plan` : `Last ${preset.label}`}
                className="px-3 h-8 text-[12px] font-medium inline-flex items-center gap-1 transition-colors disabled:cursor-not-allowed"
                style={{
                  background: active ? "var(--mk-ink)" : "var(--mk-paper)",
                  color: active ? "var(--mk-paper)" : locked ? "var(--mk-ink-40)" : "var(--mk-ink)",
                  borderLeft: preset.days !== RANGE_PRESETS[0].days ? "1px solid var(--mk-rule)" : "none",
                }}
              >
                {locked && <Lock className="h-3 w-3" />}
                {preset.label}
              </button>
            );
          })}
        </div>
        {products.length > 0 && (
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="h-8 px-2.5 rounded-lg text-[12px] cursor-pointer focus:outline-none"
            style={{
              border: "1px solid var(--mk-rule)",
              background: "var(--mk-paper)",
              color: productId ? "var(--mk-ink)" : "var(--mk-ink-60)",
            }}
            title="Filter by product"
          >
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {channel && (
          <button
            type="button"
            onClick={() => setChannel(undefined)}
            className="h-8 px-3 rounded-lg text-[12px] inline-flex items-center gap-1.5 cursor-pointer"
            style={{ border: "1px solid var(--mk-rule)", color: "var(--mk-ink)" }}
            title="Clear channel filter"
          >
            {channelLabel(channel)} ×
          </button>
        )}
        {clamped && (
          <span className="text-[11.5px]" style={{ color: "var(--mk-ink-60)" }}>
            Showing {data.window.days} days — your plan&apos;s analytics window.
          </span>
        )}
      </div>

      {error && !loading && (
        <div
          className="flex items-start gap-3 rounded-xl p-4 mb-4"
          style={{
            background: "color-mix(in oklch, var(--mk-neg) 6%, var(--mk-paper))",
            border: "1px solid color-mix(in oklch, var(--mk-neg) 30%, var(--mk-rule))",
          }}
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--mk-neg)" }} />
          <p className="flex-1 text-[13px] m-0" style={{ color: "var(--mk-ink)" }}>
            Couldn&apos;t load analytics.
          </p>
          <Button variant="outline" size="sm" className="rounded-lg text-[12px]" onClick={() => refresh()}>
            Retry
          </Button>
        </div>
      )}

      {noPostsAtAll ? (
        <div
          className="rounded-xl p-10 flex flex-col items-center text-center"
          style={{ background: "var(--mk-paper)", border: "1px solid var(--mk-rule)" }}
        >
          <div className="mk-eyebrow">No data yet</div>
          <h3
            className="mt-2 text-[18px] font-semibold m-0"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.02em" }}
          >
            Publish your first post to start measuring
          </h3>
          <p className="mt-2 text-[13px] max-w-md" style={{ color: "var(--mk-ink-60)" }}>
            Once a post goes out, Markaestro pulls its views, reach, and engagement from the
            platform within about an hour — and keeps tracking for 30 days. Follower counts are
            snapshotted daily for every connected channel.
          </p>
          <Link href="/content" className="mt-5">
            <Button className="rounded-lg h-9 text-[13px] gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Create a post
            </Button>
          </Link>
        </div>
      ) : (
        <>
          {warmingUp && (
            <div
              className="rounded-xl p-3.5 mb-4 text-[12.5px]"
              style={{
                background: "color-mix(in oklch, var(--mk-accent) 6%, var(--mk-paper))",
                border: "1px solid color-mix(in oklch, var(--mk-accent) 25%, var(--mk-rule))",
                color: "var(--mk-ink)",
              }}
            >
              Collecting metrics — the first snapshots arrive about an hour after publishing, then
              refresh on a decaying schedule for 30 days.
            </div>
          )}

          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 mb-4 sm:mb-5">
            <KpiCard
              label="Views"
              value={data?.totals.views ?? null}
              deltaPct={pctChange(data?.totals.views ?? null, data?.totals.prior?.views)}
              spark={data?.daily.map((d) => d.views)}
              sub="vs prior period"
              loading={loading}
            />
            <KpiCard
              label="Reach"
              value={data?.totals.reach ?? null}
              deltaPct={pctChange(data?.totals.reach ?? null, data?.totals.prior?.reach)}
              spark={data?.daily.map((d) => d.reach)}
              sub="unique accounts reached"
              loading={loading}
            />
            <KpiCard
              label="Engagement"
              value={data?.totals.engagements ?? null}
              deltaPct={pctChange(data?.totals.engagements ?? null, data?.totals.prior?.engagements)}
              spark={data?.daily.map((d) => d.engagements)}
              sub="likes + comments + shares + saves"
              loading={loading}
            />
            <KpiCard
              label="Engagement rate"
              value={data?.totals.engagementRateByReach ?? null}
              format="percent"
              deltaPct={pctChange(
                data?.totals.engagementRateByReach ?? null,
                data?.totals.prior?.engagementRateByReach,
              )}
              sub="engagements ÷ reach"
              loading={loading}
            />
            <KpiCard
              label="Followers"
              value={data?.totals.followers ?? null}
              deltaAbsolute={data?.totals.followerDelta}
              spark={followerSpark}
              sub="all connected channels"
              loading={loading}
            />
          </div>

          {/* Insights */}
          {data && data.insights.length > 0 && (
            <div className="grid gap-2.5 sm:gap-3 md:grid-cols-2 lg:grid-cols-3 mb-4 sm:mb-5">
              {data.insights.map((insight) => (
                <div
                  key={insight.id}
                  className="rounded-xl p-3.5 flex items-start gap-2.5"
                  style={{ background: "var(--mk-paper)", border: "1px solid var(--mk-rule)" }}
                >
                  <Lightbulb className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--mk-accent)" }} />
                  <div className="min-w-0">
                    <p className="text-[12.5px] m-0" style={{ color: "var(--mk-ink)" }}>
                      {insight.text}
                    </p>
                    <p
                      className="mt-1 mb-0 font-mono text-[10px]"
                      style={{ color: "var(--mk-ink-40)", letterSpacing: "0.06em" }}
                    >
                      BASED ON {insight.sampleSize} POSTS
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Trend + followers */}
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] mb-4 sm:mb-5">
            <Card
              eyebrow={`Performance · ${data?.window.days ?? days}d`}
              title={
                data
                  ? `${fmtCount(Math.round((data.totals[trendMetric === "posts" ? "posts" : trendMetric] as number | null) ?? 0))} ${TREND_METRICS.find((m) => m.key === trendMetric)?.label.toLowerCase()}`
                  : undefined
              }
              action={
                <div className="flex items-center gap-1">
                  {TREND_METRICS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setTrendMetric(m.key)}
                      className="px-2 h-7 rounded-md text-[11.5px] cursor-pointer transition-colors"
                      style={{
                        background: trendMetric === m.key ? "var(--mk-ink)" : "transparent",
                        color: trendMetric === m.key ? "var(--mk-paper)" : "var(--mk-ink-60)",
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              }
            >
              {loading ? (
                <Skeleton className="w-full rounded-lg" style={{ height: 220 }} />
              ) : (
                <TrendChart
                  data={data?.daily ?? []}
                  dataKey={trendMetric}
                  name={TREND_METRICS.find((m) => m.key === trendMetric)?.label ?? ""}
                />
              )}
            </Card>
            <Card
              eyebrow="Audience"
              title={data?.totals.followers !== null && data?.totals.followers !== undefined
                ? `${fmtCount(data.totals.followers)} followers`
                : "Followers"}
            >
              {loading ? (
                <Skeleton className="w-full rounded-lg" style={{ height: 200 }} />
              ) : (
                <FollowerTrendChart data={data?.followerTrend ?? []} />
              )}
            </Card>
          </div>

          {/* Best time + content types */}
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 mb-4 sm:mb-5">
            <Card eyebrow="Timing" title="When your posts perform">
              {loading ? (
                <Skeleton className="w-full rounded-lg" style={{ height: 170 }} />
              ) : (
                <BestTimeHeatmap
                  engagements={data?.heatmap.engagements ?? []}
                  posts={data?.heatmap.posts ?? []}
                  sampleSize={data?.heatmap.sampleSize ?? 0}
                />
              )}
            </Card>
            <Card eyebrow="Format" title="What earns engagement">
              {loading ? (
                <Skeleton className="w-full rounded-lg" style={{ height: 170 }} />
              ) : (
                <ContentTypeBars contentTypes={data?.contentTypes ?? []} />
              )}
            </Card>
          </div>

          {/* Channels */}
          <div className="mb-4 sm:mb-5">
            <Card eyebrow="Channels" title="Performance by channel">
              {loading ? (
                <Skeleton className="w-full rounded-lg" style={{ height: 160 }} />
              ) : (
                <ChannelTable
                  channels={data?.channels ?? []}
                  activeChannel={channel}
                  onSelect={setChannel}
                />
              )}
            </Card>
          </div>

          {/* Leaderboard */}
          <Card eyebrow="Posts" title="Top posts">
            {loading ? (
              <Skeleton className="w-full rounded-lg" style={{ height: 240 }} />
            ) : (
              <LeaderboardTable rows={data?.leaderboard ?? []} />
            )}
          </Card>

          {/* Data provenance */}
          {data && (
            <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--mk-ink-40)" }}>
              Metrics use each platform&apos;s API definitions and can lag native insights by up to
              48 hours. A &ldquo;—&rdquo; means the platform doesn&apos;t provide that metric (for
              example, Threads and TikTok don&apos;t report reach). Engagement rate is engagements ÷
              reach.
              {data.coverage.truncated &&
                ` Post-level views are based on the ${data.coverage.postsAnalyzed} most recent posts in this window.`}
              {data.coverage.lastMetricsAt &&
                ` Last metrics update ${new Date(data.coverage.lastMetricsAt).toLocaleString()}.`}
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}
