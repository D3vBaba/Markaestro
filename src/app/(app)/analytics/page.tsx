"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
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
import { EngagementBreakdown } from "@/components/analytics/EngagementBreakdown";
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

/** Focus refetches are skipped while the data on screen is younger than this. */
const FOCUS_REFETCH_MIN_MS = 60_000;

const TREND_METRIC_KEYS = ["views", "reach", "engagements", "posts"] as const;
type TrendMetric = (typeof TREND_METRIC_KEYS)[number];
type TrendMode = "publish" | "activity";

const EYEBROW = "text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500";
const SURFACE = "rounded-2xl border border-slate-200/80 bg-white shadow-xs dark:border-slate-800/80 dark:bg-slate-900";
const SEGMENT = "inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80";
const segment = (active: boolean, locked = false) =>
  `inline-flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
    active
      ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100"
      : locked
        ? "cursor-not-allowed text-slate-400 opacity-50"
        : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
  }`;
const SELECT = "h-9 cursor-pointer rounded-xl border border-slate-200 bg-slate-100 px-3 text-xs font-semibold text-slate-700 outline-none transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600";
const DATE_INPUT = "h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";

function pctChange(current: number | null, prior: number | null | undefined): number | null {
  if (current === null || prior === null || prior === undefined || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function Card({
  eyebrow,
  title,
  children,
  action,
  className,
}: {
  eyebrow: string;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 p-5 sm:p-6 ${SURFACE} ${className ?? ""}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={EYEBROW}>{eyebrow}</p>
          {title && <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h2>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function AnalyticsPage() {
  const t = useTranslations("analytics.page");
  const locale = useLocale();
  const [days, setDays] = useState(28);
  const [customRange, setCustomRange] = useState<{ since: string; until: string } | null>(null);
  const [draftRange, setDraftRange] = useState<{ since: string; until: string }>(() => {
    const today = new Date();
    return { since: isoDate(new Date(today.getTime() - 27 * 86_400_000)), until: isoDate(today) };
  });
  const [channel, setChannel] = useState<SocialChannel | undefined>(undefined);
  const [productId, setProductId] = useState<string>("");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("views");
  const [trendMode, setTrendMode] = useState<TrendMode>("publish");
  const [compare, setCompare] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const { data: productsData } = useApiQuery<{ products: Array<{ id: string; name: string }> }>("/api/products");
  const products = productsData?.products ?? [];

  const { canAccess, getLimit, loading: subLoading } = useSubscription();
  const maxDays = getLimit("analyticsWindowDays");
  const canExport = canAccess("analyticsCsvExport");

  const [clampedForMaxDays, setClampedForMaxDays] = useState(maxDays);
  if (maxDays !== clampedForMaxDays) setClampedForMaxDays(maxDays);
  if (!subLoading && maxDays !== -1 && maxDays > 0 && days > maxDays) {
    const widest = [...RANGE_PRESETS].reverse().find((preset) => preset.days <= maxDays);
    setDays(widest?.days ?? RANGE_PRESETS[0].days);
  }

  const tz = useMemo(() => -new Date().getTimezoneOffset(), []);
  const filterParams = `${channel ? `&channel=${channel}` : ""}${productId ? `&productId=${encodeURIComponent(productId)}` : ""}`;
  const rangeParams = customRange ? `&since=${customRange.since}&until=${customRange.until}` : "";
  const path = `/api/analytics?days=${days}&tz=${tz}${rangeParams}${filterParams}`;
  const { data, loading, refreshing, error, refresh } = useApiQuery<AnalyticsResponse>(path);

  const clamped = data && data.window.days < data.window.requestedDays;
  const noPostsAtAll = data && !loading && !channel && !productId && !customRange
    && data.totals.posts === 0 && data.coverage.postsAnalyzed === 0
    && data.followerTrend.length === 0;
  const warmingUp = data && !loading && !noPostsAtAll
    && data.coverage.postsAnalyzed > 0 && data.coverage.postsWithMetrics === 0;

  const followerSpark = data?.followerTrend.map((p) => p.total) ?? [];
  // Engagement rate by reach when any channel in scope reports reach;
  // otherwise by views, and the label says which, never a blank tile.
  const engagementRate = useMemo(() => {
    const byReach = data?.totals.engagementRateByReach ?? null;
    if (byReach !== null) {
      return { value: byReach, delta: pctChange(byReach, data?.totals.prior?.engagementRateByReach), byReach: true };
    }
    const byViews = data?.totals.engagementRateByViews ?? null;
    return { value: byViews, delta: pctChange(byViews, data?.totals.prior?.engagementRateByViews), byReach: false };
  }, [data]);

  const trendSeries = trendMode === "activity" ? data?.dailyActivity ?? [] : data?.daily ?? [];
  const compareSeries = compare && trendMode === "publish" && data?.priorDaily.length
    ? data.priorDaily.map((point) => point[trendMetric])
    : undefined;
  const activityUnavailable = trendMode === "activity" && data && data.dailyActivity.every((p) => p.views === 0 && p.reach === 0 && p.engagements === 0);

  // A dashboard someone leaves open should not drift: re-read the stored
  // numbers when the tab regains focus. This is a cache read, not a platform
  // pull, so it costs nothing against the refresh rate limit, but each read
  // is a few hundred Firestore documents, so tab-flipping is throttled.
  const lastFetchedAtRef = useRef(0);
  useEffect(() => {
    if (data) lastFetchedAtRef.current = Date.now();
  }, [data]);
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchedAtRef.current < FOCUS_REFETCH_MIN_MS) return;
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  function applyCustomRange() {
    if (!draftRange.since || !draftRange.until || draftRange.since > draftRange.until) {
      toast.error(t("filters.invalidRange"));
      return;
    }
    setCustomRange({ since: draftRange.since, until: draftRange.until });
  }

  function choosePreset(preset: number) {
    setCustomRange(null);
    setDays(preset);
  }

  async function handleRefresh() {
    if (syncing || refreshing) return;
    setSyncing(true);
    try {
      const res = await apiPost<{
        updated: number;
        scanned: number;
        remaining: number;
        followersUpdated: number;
        errorCount: number;
        firstError: string | null;
        refreshedAt: string;
      }>("/api/analytics/refresh", {
        days: data?.window.days ?? days,
        ...(channel ? { channel } : {}),
        ...(productId ? { productId } : {}),
      });
      if (res.ok) {
        setLastRefreshedAt(res.data.refreshedAt);
        if (res.data.errorCount > 0) {
          toast.warning(t("toasts.partial", { count: res.data.errorCount, error: res.data.firstError ?? "" }));
        } else if (res.data.updated > 0) {
          toast.success(
            res.data.remaining > 0
              ? t("toasts.updatedPartial", { updated: res.data.updated, scanned: res.data.scanned })
              : t("toasts.updatedOf", { updated: res.data.updated, scanned: res.data.scanned }),
          );
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
      const res = await apiDownload(`/api/analytics/export?days=${Math.min(data?.window.days ?? days, 730)}${filterParams}`);
      if (!res.ok || !res.blob) {
        toast.error(t("toasts.exportFailed"));
        return;
      }
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `markaestro-analytics-${data?.window.days ?? days}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const trendTitle = data
    ? `${fmtCount(Math.round(trendSeries.reduce((sum, point) => sum + (point[trendMetric] ?? 0), 0)), locale)} ${t(`trend.metrics.${trendMetric}`)}`
    : undefined;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {(lastRefreshedAt || data?.coverage.lastMetricsAt) && (
              <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500" title={t("refresh.lastUpdatedTitle")}>
                {t("refresh.lastUpdated", {
                  time: new Date(lastRefreshedAt ?? data!.coverage.lastMetricsAt!).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
                })}
              </span>
            )}
            <Button
              variant="outline"
              className="h-9 gap-2 rounded-xl border-slate-200/80 bg-white text-xs font-medium shadow-2xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
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
                className="h-9 gap-2 rounded-xl border-slate-200/80 bg-white text-xs font-medium shadow-2xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                onClick={handleExport}
                disabled={exporting || loading}
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? t("export.exporting") : t("export.idle")}
              </Button>
            ) : (
              <Button variant="outline" className="h-9 gap-2 rounded-xl border-slate-200 text-xs font-medium opacity-60 dark:border-slate-800" disabled title={t("export.lockedTitle")}>
                <Lock className="h-3.5 w-3.5" />
                {t("export.idle")}
              </Button>
            )}
          </div>
        }
      />

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-2.5">
        <div className={SEGMENT}>
          {RANGE_PRESETS.map((preset) => {
            const locked = maxDays !== -1 && maxDays > 0 && preset.days > maxDays;
            const active = !customRange && days === preset.days;
            return (
              <button
                key={preset.days}
                type="button"
                disabled={locked}
                onClick={() => choosePreset(preset.days)}
                title={locked ? t("filters.rangeLockedTitle", { label: preset.label }) : t("filters.rangeTitle", { label: preset.label })}
                className={segment(active, locked)}
              >
                {locked && <Lock className="h-3 w-3" />}
                {preset.label}
              </button>
            );
          })}
          <button type="button" onClick={() => setCustomRange({ ...draftRange })} className={segment(Boolean(customRange))} title={t("filters.customTitle")}>
            {t("filters.custom")}
          </button>
        </div>

        {customRange && (
          <form
            className="flex flex-wrap items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              applyCustomRange();
            }}
          >
            <input
              type="date"
              value={draftRange.since}
              max={draftRange.until}
              onChange={(event) => setDraftRange((range) => ({ ...range, since: event.target.value }))}
              aria-label={t("filters.from")}
              className={DATE_INPUT}
            />
            <span className="text-xs text-slate-400">{t("filters.to")}</span>
            <input
              type="date"
              value={draftRange.until}
              min={draftRange.since}
              max={isoDate(new Date())}
              onChange={(event) => setDraftRange((range) => ({ ...range, until: event.target.value }))}
              aria-label={t("filters.until")}
              className={DATE_INPUT}
            />
            <Button type="submit" size="sm" className="h-9 rounded-xl text-xs font-semibold">{t("filters.apply")}</Button>
          </form>
        )}

        <select
          value={channel ?? ""}
          onChange={(e) => setChannel((e.target.value || undefined) as SocialChannel | undefined)}
          className={SELECT}
          title={t("filters.platformTitle")}
        >
          <option value="">{t("filters.allPlatforms")}</option>
          {socialChannels.map((ch) => (
            <option key={ch} value={ch}>{channelLabel(ch)}</option>
          ))}
        </select>

        {products.length > 0 && (
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className={SELECT} title={t("filters.brandTitle")}>
            <option value="">{t("filters.allBrands")}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        {clamped && (
          <span className="text-xs font-medium text-slate-400">{t("filters.windowNote", { days: data.window.days })}</span>
        )}
        {data?.window.custom && !clamped && (
          <span className="text-xs text-slate-400">{t("filters.showing", { since: data.window.since, until: data.window.until })}</span>
        )}
      </div>

      {error && !loading && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/80 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <p className="m-0 flex-1 text-[13px] text-rose-900 dark:text-rose-200">{t("error.message")}</p>
          <Button variant="outline" size="sm" className="rounded-lg text-[12px]" onClick={() => refresh()}>
            {t("error.retry")}
          </Button>
        </div>
      )}

      {noPostsAtAll ? (
        <div className={`flex flex-col items-center p-10 text-center ${SURFACE}`}>
          <p className={EYEBROW}>{t("emptyState.eyebrow")}</p>
          <h3 className="m-0 mt-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("emptyState.title")}</h3>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{t("emptyState.body")}</p>
          <Link href="/content" className="mt-5">
            <Button className="h-9 gap-1.5 rounded-xl text-[13px]">
              <Plus className="h-3.5 w-3.5" />
              {t("emptyState.createPost")}
            </Button>
          </Link>
        </div>
      ) : (
        <>
          {warmingUp && (
            <div className="mb-4 rounded-2xl border border-blue-200/60 bg-blue-50/70 px-4 py-3 text-[12.5px] leading-relaxed text-slate-700 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-slate-300">
              {t("warmingUp")}
            </div>
          )}

          {/* KPI row */}
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <KpiCard label={t("kpis.views.label")} value={data?.totals.views ?? null} deltaPct={pctChange(data?.totals.views ?? null, data?.totals.prior?.views)} spark={data?.daily.map((d) => d.views)} sub={t("kpis.views.sub")} loading={loading} />
            <KpiCard label={t("kpis.reach.label")} value={data?.totals.reach ?? null} deltaPct={pctChange(data?.totals.reach ?? null, data?.totals.prior?.reach)} spark={data?.daily.map((d) => d.reach)} sub={t("kpis.reach.sub")} loading={loading} />
            <KpiCard label={t("kpis.engagement.label")} value={data?.totals.engagements ?? null} deltaPct={pctChange(data?.totals.engagements ?? null, data?.totals.prior?.engagements)} spark={data?.daily.map((d) => d.engagements)} sub={t("kpis.engagement.sub")} loading={loading} />
            <KpiCard label={t("kpis.engagementRate.label")} value={engagementRate.value} format="percent" deltaPct={engagementRate.delta} sub={engagementRate.byReach ? t("kpis.engagementRate.sub") : t("kpis.engagementRate.subViews")} loading={loading} />
            <KpiCard label={t("kpis.followers.label")} value={data?.totals.followers ?? null} deltaAbsolute={data?.totals.followerDelta} spark={followerSpark} sub={t("kpis.followers.sub")} loading={loading} />
          </div>

          {/* Insights */}
          {data && data.insights.length > 0 && (
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {data.insights.map((insight) => (
                <div key={insight.id} className={`flex items-start gap-3 p-4 ${SURFACE}`}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blue-200/50 bg-blue-50 text-blue-600 dark:border-blue-800/50 dark:bg-blue-950/60 dark:text-blue-400">
                    <Lightbulb className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">{insight.text}</p>
                    <p className={`mb-0 mt-1.5 ${EYEBROW}`}>{t("insights.basedOn", { count: insight.sampleSize })}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Trend + followers */}
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card
              eyebrow={t("trend.eyebrow", { days: data?.window.days ?? days })}
              title={trendTitle}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <div className={SEGMENT}>
                    {TREND_METRIC_KEYS.map((key) => (
                      <button key={key} type="button" onClick={() => setTrendMetric(key)} className={segment(trendMetric === key)}>
                        {t(`trend.metrics.${key}`)}
                      </button>
                    ))}
                  </div>
                  <div className={SEGMENT}>
                    {(["publish", "activity"] as const).map((mode) => (
                      <button key={mode} type="button" onClick={() => setTrendMode(mode)} className={segment(trendMode === mode)} title={t(`trend.modeTitles.${mode}`)}>
                        {t(`trend.modes.${mode}`)}
                      </button>
                    ))}
                  </div>
                  <label className={`inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium ${trendMode === "activity" ? "text-slate-300 dark:text-slate-600" : "text-slate-500 dark:text-slate-400"}`}>
                    <input type="checkbox" checked={compare} disabled={trendMode === "activity"} onChange={(event) => setCompare(event.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-800" />
                    {t("trend.compare")}
                  </label>
                </div>
              }
            >
              {loading ? (
                <Skeleton className="w-full rounded-xl" style={{ height: 220 }} />
              ) : activityUnavailable ? (
                <div className="flex h-[220px] items-center justify-center px-6 text-center text-[13px] text-slate-500 dark:text-slate-400">{t("trend.activityEmpty")}</div>
              ) : (
                <>
                  <TrendChart
                    data={trendSeries}
                    dataKey={trendMetric}
                    name={t(`trend.metrics.${trendMetric}`)}
                    locale={locale}
                    compare={compareSeries}
                    compareName={t("trend.previous")}
                  />
                  <p className="mb-0 mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                    {trendMode === "activity" ? t("trend.noteActivity") : t("trend.note")}
                  </p>
                </>
              )}
            </Card>
            <Card
              eyebrow={t("audience.eyebrow")}
              title={data?.totals.followers !== null && data?.totals.followers !== undefined
                ? t("audience.titleWithCount", { count: fmtCount(data.totals.followers, locale) })
                : t("audience.title")}
            >
              {loading ? <Skeleton className="w-full rounded-xl" style={{ height: 200 }} /> : <FollowerTrendChart data={data?.followerTrend ?? []} locale={locale} />}
            </Card>
          </div>

          {/* Breakdown + best time + content types */}
          <div className="mb-4 grid gap-4 sm:mb-5 sm:gap-5 lg:grid-cols-3">
            <Card eyebrow={t("breakdown.eyebrow")} title={t("breakdown.title")}>
              {loading || !data ? <Skeleton className="w-full rounded-lg" style={{ height: 170 }} /> : <EngagementBreakdown breakdown={data.breakdown} />}
            </Card>
            <Card eyebrow={t("timing.eyebrow")} title={t("timing.title")}>
              {loading ? (
                <Skeleton className="w-full rounded-lg" style={{ height: 170 }} />
              ) : (
                <BestTimeHeatmap engagements={data?.heatmap.engagements ?? []} posts={data?.heatmap.posts ?? []} sampleSize={data?.heatmap.sampleSize ?? 0} />
              )}
            </Card>
            <Card eyebrow={t("format.eyebrow")} title={t("format.title")}>
              {loading ? <Skeleton className="w-full rounded-lg" style={{ height: 170 }} /> : <ContentTypeBars contentTypes={data?.contentTypes ?? []} />}
            </Card>
          </div>

          {/* Channels */}
          <div className="mb-4 sm:mb-5">
            <Card eyebrow={t("channels.eyebrow")} title={t("channels.title")}>
              {loading ? <Skeleton className="w-full rounded-lg" style={{ height: 160 }} /> : <ChannelTable channels={data?.channels ?? []} activeChannel={channel} onSelect={setChannel} />}
            </Card>
          </div>

          {/* Leaderboard */}
          <Card eyebrow={t("posts.eyebrow")} title={t("posts.title")}>
            {loading ? <Skeleton className="w-full rounded-lg" style={{ height: 240 }} /> : <LeaderboardTable rows={data?.leaderboard ?? []} />}
          </Card>

          {/* Data provenance */}
          {data && (
            <p className="mt-4 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              {t("provenance.base")}
              {data.coverage.truncated && t("provenance.truncated", { count: data.coverage.postsAnalyzed })}
              {data.coverage.lastMetricsAt && t("provenance.lastUpdate", { date: new Date(data.coverage.lastMetricsAt).toLocaleString(locale) })}
            </p>
          )}
        </>
      )}
    </>
  );
}
