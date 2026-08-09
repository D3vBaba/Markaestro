"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { apiDownload, apiPost } from "@/lib/api-client";
import { KpiCard } from "@/components/analytics/KpiCard";
import { TrendChart, FollowerTrendChart } from "@/components/analytics/TrendChart";
import { BestTimeHeatmap } from "@/components/analytics/BestTimeHeatmap";
import { LeaderboardTable } from "@/components/analytics/LeaderboardTable";
import { ContentTypeBars } from "@/components/analytics/ContentTypeBars";
import { ChannelTable } from "@/components/analytics/ChannelTable";
import { channelLabel } from "@/components/mk/channels";
import { fmtCount } from "@/components/mk/format";
import type { AnalyticsResponse } from "@/lib/analytics/api-shape";
import { socialChannels, type SocialChannel } from "@/lib/schemas";
import { AlertCircle, Download, Lightbulb, Lock, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const RANGE_PRESETS = [
  { days: 7, label: "7d" },
  { days: 28, label: "28d" },
  { days: 90, label: "90d" },
  { days: 365, label: "12m" },
];

const TREND_METRIC_KEYS = ["views", "reach", "engagements", "posts"] as const;

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
  const t = useTranslations("analytics.page");
  const locale = useLocale();
  const [days, setDays] = useState(28);
  const [channel, setChannel] = useState<SocialChannel | undefined>(undefined);
  const [productId, setProductId] = useState<string>("");
  const [trendMetric, setTrendMetric] = useState<(typeof TREND_METRIC_KEYS)[number]>("views");
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { data: productsData } = useApiQuery<{ products: Array<{ id: string; name: string }> }>(
    "/api/products",
  );
  const products = productsData?.products ?? [];

  const { canAccess, getLimit, loading: subLoading } = useSubscription();
  const maxDays = getLimit("analyticsWindowDays");
  const canExport = canAccess("analyticsCsvExport");

  // Land on the widest range the plan allows instead of a locked preset.
  // getLimit() returns 0 until the subscription status loads; clamping against
  // that would force the window to 0 and — since this clamp only ever shrinks
  // `days` — leave it stuck there even after the real limit arrives. So wait
  // for a real, positive (or unlimited) limit before touching `days`, and
  // never fall back to 0.
  useEffect(() => {
    if (subLoading || maxDays === -1 || maxDays <= 0) return;
    if (days > maxDays) {
      const widest = [...RANGE_PRESETS].reverse().find((p) => p.days <= maxDays);
      setDays(widest?.days ?? RANGE_PRESETS[0].days);
    }
  }, [maxDays, days, subLoading]);

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

  // Pull fresh numbers straight from each platform (bypassing the background
  // poller's schedule), then re-read the analytics so the page reflects them.
  async function handleRefresh() {
    if (syncing || refreshing) return;
    setSyncing(true);
    try {
      const res = await apiPost<{ updated: number; scanned: number }>("/api/analytics/refresh", {
        ...(channel ? { channel } : {}),
        ...(productId ? { productId } : {}),
      });
      if (res.ok) {
        if (res.data.updated > 0) {
          toast.success(t("toasts.updated", { count: res.data.updated }));
        } else {
          toast.message(t("toasts.noNewMetrics"));
        }
      } else if (res.status === 429) {
        toast.error(t("toasts.tooManyRefreshes"));
      } else {
        toast.error(t("toasts.pullFailed"));
      }
    } catch {
      toast.error(t("toasts.pullFailed"));
    } finally {
      await refresh();
      setSyncing(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await apiDownload(`/api/analytics/export?days=${Math.min(days, 730)}${filterParams}`);
      if (!res.ok || !res.blob) {
        toast.error(t("toasts.exportFailed"));
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
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              className="rounded-lg h-9 text-[13px] gap-1.5"
              onClick={handleRefresh}
              disabled={loading || refreshing || syncing}
              title={t("refresh.title")}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing || refreshing ? "animate-spin" : ""}`} />
              {syncing ? t("refresh.pulling") : refreshing ? t("refresh.refreshing") : t("refresh.idle")}
            </Button>
            {canExport ? (
              <Button
                variant="outline"
                className="rounded-lg h-9 text-[13px] gap-1.5"
                onClick={handleExport}
                disabled={exporting || loading}
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? t("export.exporting") : t("export.idle")}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="rounded-lg h-9 text-[13px] gap-1.5 opacity-60"
                disabled
                title={t("export.lockedTitle")}
              >
                <Lock className="h-3.5 w-3.5" />
                {t("export.idle")}
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
            // maxDays is 0 until the subscription loads — don't flash every
            // preset as locked during that window.
            const locked = maxDays !== -1 && maxDays > 0 && preset.days > maxDays;
            const active = days === preset.days;
            return (
              <button
                key={preset.days}
                type="button"
                disabled={locked}
                onClick={() => setDays(preset.days)}
                title={
                  locked
                    ? t("filters.rangeLockedTitle", { label: preset.label })
                    : t("filters.rangeTitle", { label: preset.label })
                }
                className="px-3.5 sm:px-3 h-10 sm:h-8 text-[12px] font-medium inline-flex items-center gap-1 transition-colors disabled:cursor-not-allowed"
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
        <select
          value={channel ?? ""}
          onChange={(e) => setChannel((e.target.value || undefined) as SocialChannel | undefined)}
          className="h-10 sm:h-8 px-2.5 rounded-lg text-[12px] cursor-pointer focus:outline-none max-w-full"
          style={{
            border: "1px solid var(--mk-rule)",
            background: "var(--mk-paper)",
            color: channel ? "var(--mk-ink)" : "var(--mk-ink-60)",
          }}
          title={t("filters.platformTitle")}
        >
          <option value="">{t("filters.allPlatforms")}</option>
          {socialChannels.map((ch) => (
            <option key={ch} value={ch}>
              {channelLabel(ch)}
            </option>
          ))}
        </select>
        {products.length > 0 && (
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="h-10 sm:h-8 px-2.5 rounded-lg text-[12px] cursor-pointer focus:outline-none max-w-full sm:max-w-[240px]"
            style={{
              border: "1px solid var(--mk-rule)",
              background: "var(--mk-paper)",
              color: productId ? "var(--mk-ink)" : "var(--mk-ink-60)",
            }}
            title={t("filters.brandTitle")}
          >
            <option value="">{t("filters.allBrands")}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {clamped && (
          <span className="text-[11.5px]" style={{ color: "var(--mk-ink-60)" }}>
            {t("filters.windowNote", { days: data.window.days })}
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
            {t("error.message")}
          </p>
          <Button variant="outline" size="sm" className="rounded-lg text-[12px]" onClick={() => refresh()}>
            {t("error.retry")}
          </Button>
        </div>
      )}

      {noPostsAtAll ? (
        <div
          className="rounded-xl p-10 flex flex-col items-center text-center"
          style={{ background: "var(--mk-paper)", border: "1px solid var(--mk-rule)" }}
        >
          <div className="mk-eyebrow">{t("emptyState.eyebrow")}</div>
          <h3
            className="mt-2 text-[18px] font-semibold m-0"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.02em" }}
          >
            {t("emptyState.title")}
          </h3>
          <p className="mt-2 text-[13px] max-w-md" style={{ color: "var(--mk-ink-60)" }}>
            {t("emptyState.body")}
          </p>
          <Link href="/content" className="mt-5">
            <Button className="rounded-lg h-9 text-[13px] gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              {t("emptyState.createPost")}
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
              {t("warmingUp")}
            </div>
          )}

          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 mb-4 sm:mb-5">
            <KpiCard
              label={t("kpis.views.label")}
              value={data?.totals.views ?? null}
              deltaPct={pctChange(data?.totals.views ?? null, data?.totals.prior?.views)}
              spark={data?.daily.map((d) => d.views)}
              sub={t("kpis.views.sub")}
              loading={loading}
            />
            <KpiCard
              label={t("kpis.reach.label")}
              value={data?.totals.reach ?? null}
              deltaPct={pctChange(data?.totals.reach ?? null, data?.totals.prior?.reach)}
              spark={data?.daily.map((d) => d.reach)}
              sub={t("kpis.reach.sub")}
              loading={loading}
            />
            <KpiCard
              label={t("kpis.engagement.label")}
              value={data?.totals.engagements ?? null}
              deltaPct={pctChange(data?.totals.engagements ?? null, data?.totals.prior?.engagements)}
              spark={data?.daily.map((d) => d.engagements)}
              sub={t("kpis.engagement.sub")}
              loading={loading}
            />
            <KpiCard
              label={t("kpis.engagementRate.label")}
              value={data?.totals.engagementRateByReach ?? null}
              format="percent"
              deltaPct={pctChange(
                data?.totals.engagementRateByReach ?? null,
                data?.totals.prior?.engagementRateByReach,
              )}
              sub={t("kpis.engagementRate.sub")}
              loading={loading}
            />
            <KpiCard
              label={t("kpis.followers.label")}
              value={data?.totals.followers ?? null}
              deltaAbsolute={data?.totals.followerDelta}
              spark={followerSpark}
              sub={t("kpis.followers.sub")}
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
                      {t("insights.basedOn", { count: insight.sampleSize })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Trend + followers */}
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] mb-4 sm:mb-5">
            <Card
              eyebrow={t("trend.eyebrow", { days: data?.window.days ?? days })}
              title={
                data
                  ? `${fmtCount(Math.round((data.totals[trendMetric === "posts" ? "posts" : trendMetric] as number | null) ?? 0), locale)} ${t(`trend.metrics.${trendMetric}`)}`
                  : undefined
              }
              action={
                <div className="flex items-center gap-1 flex-wrap">
                  {TREND_METRIC_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTrendMetric(key)}
                      className="px-3 sm:px-2 h-9 sm:h-7 rounded-md text-[11.5px] cursor-pointer transition-colors"
                      style={{
                        background: trendMetric === key ? "var(--mk-ink)" : "transparent",
                        color: trendMetric === key ? "var(--mk-paper)" : "var(--mk-ink-60)",
                      }}
                    >
                      {t(`trend.metrics.${key}`)}
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
                  name={t(`trend.metrics.${trendMetric}`)}
                  locale={locale}
                />
              )}
            </Card>
            <Card
              eyebrow={t("audience.eyebrow")}
              title={data?.totals.followers !== null && data?.totals.followers !== undefined
                ? t("audience.titleWithCount", { count: fmtCount(data.totals.followers, locale) })
                : t("audience.title")}
            >
              {loading ? (
                <Skeleton className="w-full rounded-lg" style={{ height: 200 }} />
              ) : (
                <FollowerTrendChart data={data?.followerTrend ?? []} locale={locale} />
              )}
            </Card>
          </div>

          {/* Best time + content types */}
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 mb-4 sm:mb-5">
            <Card eyebrow={t("timing.eyebrow")} title={t("timing.title")}>
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
            <Card eyebrow={t("format.eyebrow")} title={t("format.title")}>
              {loading ? (
                <Skeleton className="w-full rounded-lg" style={{ height: 170 }} />
              ) : (
                <ContentTypeBars contentTypes={data?.contentTypes ?? []} />
              )}
            </Card>
          </div>

          {/* Channels */}
          <div className="mb-4 sm:mb-5">
            <Card eyebrow={t("channels.eyebrow")} title={t("channels.title")}>
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
          <Card eyebrow={t("posts.eyebrow")} title={t("posts.title")}>
            {loading ? (
              <Skeleton className="w-full rounded-lg" style={{ height: 240 }} />
            ) : (
              <LeaderboardTable rows={data?.leaderboard ?? []} />
            )}
          </Card>

          {/* Data provenance */}
          {data && (
            <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--mk-ink-40)" }}>
              {t("provenance.base")}
              {data.coverage.truncated &&
                t("provenance.truncated", { count: data.coverage.postsAnalyzed })}
              {data.coverage.lastMetricsAt &&
                t("provenance.lastUpdate", {
                  date: new Date(data.coverage.lastMetricsAt).toLocaleString(locale),
                })}
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}
