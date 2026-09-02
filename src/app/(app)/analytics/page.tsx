"use client";

import { useEffect, useMemo, useState } from "react";
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
    <div className="rounded-2xl p-5 sm:p-6 min-w-0 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{eyebrow}</div>
          {title && (
            <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
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

  const [clampedForMaxDays, setClampedForMaxDays] = useState(maxDays);
  if (maxDays !== clampedForMaxDays) setClampedForMaxDays(maxDays);
  if (!subLoading && maxDays !== -1 && maxDays > 0 && days > maxDays) {
    const widest = [...RANGE_PRESETS].reverse().find((preset) => preset.days <= maxDays);
    setDays(widest?.days ?? RANGE_PRESETS[0].days);
  }

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

  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  // A dashboard someone leaves open should not drift: re-read the stored
  // numbers when the tab regains focus. This is a cache read, not a platform
  // pull, so it costs nothing against the refresh rate limit.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

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
        days,
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
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {(lastRefreshedAt || data?.coverage.lastMetricsAt) && (
              <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums" title={t("refresh.lastUpdatedTitle")}>
                {t("refresh.lastUpdated", {
                  time: new Date(lastRefreshedAt ?? data!.coverage.lastMetricsAt!).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
                })}
              </span>
            )}
            <Button
              variant="outline"
              className="rounded-xl h-9 text-xs font-medium gap-2 border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800"
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
                className="rounded-xl h-9 text-xs font-medium gap-2 border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800"
                onClick={handleExport}
                disabled={exporting || loading}
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? t("export.exporting") : t("export.idle")}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="rounded-xl h-9 text-xs font-medium gap-2 opacity-60 border-slate-200 dark:border-slate-800"
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
      <div className="flex items-center gap-2.5 flex-wrap mb-6">
        <div className="inline-flex rounded-xl p-1 bg-slate-100 dark:bg-slate-800/80">
          {RANGE_PRESETS.map((preset) => {
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
                className={`px-3 py-1 text-xs font-semibold rounded-lg inline-flex items-center gap-1 transition-colors cursor-pointer ${
                  active
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                    : locked
                    ? "text-slate-400 opacity-50 cursor-not-allowed"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
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
          className="h-9 px-3 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 outline-none cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
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
            className="h-9 px-3 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 outline-none cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
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
          <span className="text-xs text-slate-400 font-medium">
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
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
              value={engagementRate.value}
              format="percent"
              deltaPct={engagementRate.delta}
              sub={engagementRate.byReach ? t("kpis.engagementRate.sub") : t("kpis.engagementRate.subViews")}
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
              {data.insights.map((insight) => (
                <div
                  key={insight.id}
                  className="rounded-2xl p-4 flex items-start gap-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs"
                >
                  <div className="h-8 w-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200/50 dark:border-blue-800/50 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400">
                    <Lightbulb className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-relaxed font-medium text-slate-700 dark:text-slate-300 m-0">
                      {insight.text}
                    </p>
                    <p className="mt-1.5 mb-0 text-[10.5px] font-semibold text-slate-400">
                      {t("insights.basedOn", { count: insight.sampleSize })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Trend + followers */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] mb-6">
            <Card
              eyebrow={t("trend.eyebrow", { days: data?.window.days ?? days })}
              title={
                data
                  ? `${fmtCount(Math.round((data.totals[trendMetric === "posts" ? "posts" : trendMetric] as number | null) ?? 0), locale)} ${t(`trend.metrics.${trendMetric}`)}`
                  : undefined
              }
              action={
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 flex-wrap">
                  {TREND_METRIC_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTrendMetric(key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        trendMetric === key
                          ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {t(`trend.metrics.${key}`)}
                    </button>
                  ))}
                </div>
              }
            >
              {loading ? (
                <Skeleton className="w-full rounded-xl" style={{ height: 220 }} />
              ) : (
                <>
                  <TrendChart
                    data={data?.daily ?? []}
                    dataKey={trendMetric}
                    name={t(`trend.metrics.${trendMetric}`)}
                    locale={locale}
                  />
                  <p className="mt-2 mb-0 text-[11px] text-slate-400 dark:text-slate-500">{t("trend.note")}</p>
                </>
              )}
            </Card>
            <Card
              eyebrow={t("audience.eyebrow")}
              title={data?.totals.followers !== null && data?.totals.followers !== undefined
                ? t("audience.titleWithCount", { count: fmtCount(data.totals.followers, locale) })
                : t("audience.title")}
            >
              {loading ? (
                <Skeleton className="w-full rounded-xl" style={{ height: 200 }} />
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
    </>
  );
}
