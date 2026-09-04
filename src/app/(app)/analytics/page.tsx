"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/app/PageHeader";
import Section from "@/components/app/Section";
import Notice from "@/components/app/Notice";
import EmptyState from "@/components/app/EmptyState";
import Select from "@/components/app/Select";
import { StatGrid } from "@/components/app/StatTile";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
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

function pctChange(current: number | null, prior: number | null | undefined): number | null {
  if (current === null || prior === null || prior === undefined || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
      }, undefined, {
        // The server pulls up to 60 posts within a 40 s budget and then
        // captures followers; the default client timeout is shorter than
        // that and reported a failure while the server was still succeeding.
        timeoutMs: 60_000,
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
          <>
            {(lastRefreshedAt || data?.coverage.lastMetricsAt) && (
              <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline" title={t("refresh.lastUpdatedTitle")}>
                {t("refresh.lastUpdated", {
                  time: new Date(lastRefreshedAt ?? data!.coverage.lastMetricsAt!).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
                })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading || refreshing || syncing}
              title={t("refresh.title")}
            >
              <RefreshCw className={cn("size-3.5", (syncing || refreshing) && "animate-spin")} />
              {syncing ? t("refresh.pulling") : refreshing ? t("refresh.refreshing") : t("refresh.idle")}
            </Button>
            {canExport ? (
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || loading}>
                <Download className="size-3.5" />
                {exporting ? t("export.exporting") : t("export.idle")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled title={t("export.lockedTitle")}>
                <Lock className="size-3.5" />
                {t("export.idle")}
              </Button>
            )}
          </>
        }
      >
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={customRange ? "custom" : String(days)}
            onValueChange={(v) => (v === "custom" ? setCustomRange({ ...draftRange }) : choosePreset(Number(v)))}
          >
            <TabsList>
              {RANGE_PRESETS.map((preset) => {
                const locked = maxDays !== -1 && maxDays > 0 && preset.days > maxDays;
                return (
                  <TabsTrigger
                    key={preset.days}
                    value={String(preset.days)}
                    disabled={locked}
                    title={locked ? t("filters.rangeLockedTitle", { label: preset.label }) : t("filters.rangeTitle", { label: preset.label })}
                  >
                    {locked && <Lock className="size-3" />}
                    {preset.label}
                  </TabsTrigger>
                );
              })}
              <TabsTrigger value="custom" title={t("filters.customTitle")}>{t("filters.custom")}</TabsTrigger>
            </TabsList>
          </Tabs>

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
                className="h-8 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
              />
              <span className="text-xs text-muted-foreground">{t("filters.to")}</span>
              <input
                type="date"
                value={draftRange.until}
                min={draftRange.since}
                max={isoDate(new Date())}
                onChange={(event) => setDraftRange((range) => ({ ...range, until: event.target.value }))}
                aria-label={t("filters.until")}
                className="h-8 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
              />
              <Button type="submit" size="sm">{t("filters.apply")}</Button>
            </form>
          )}

          <Select
            size="sm"
            value={channel ?? ""}
            onChange={(e) => setChannel((e.target.value || undefined) as SocialChannel | undefined)}
            className="w-auto min-w-36"
            title={t("filters.platformTitle")}
          >
            <option value="">{t("filters.allPlatforms")}</option>
            {socialChannels.map((ch) => (
              <option key={ch} value={ch}>{channelLabel(ch)}</option>
            ))}
          </Select>

          {products.length > 0 && (
            <Select size="sm" value={productId} onChange={(e) => setProductId(e.target.value)} className="w-auto min-w-36" title={t("filters.brandTitle")}>
              <option value="">{t("filters.allBrands")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          )}

          {clamped && (
            <span className="text-xs text-muted-foreground">{t("filters.windowNote", { days: data.window.days })}</span>
          )}
          {data?.window.custom && !clamped && (
            <span className="text-xs text-muted-foreground">{t("filters.showing", { since: data.window.since, until: data.window.until })}</span>
          )}
        </div>
      </PageHeader>

      {error && !loading && (
        <Notice
          tone="negative"
          icon={AlertCircle}
          className="mb-6"
          action={
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              {t("error.retry")}
            </Button>
          }
        >
          {t("error.message")}
        </Notice>
      )}

      {noPostsAtAll ? (
        <EmptyState
          title={t("emptyState.title")}
          description={t("emptyState.body")}
          action={
            <Button asChild>
              <Link href="/content">
                <Plus className="size-4" />
                {t("emptyState.createPost")}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-10">
          {warmingUp && (
            <Notice tone="accent">{t("warmingUp")}</Notice>
          )}

          <StatGrid columns={4} className="lg:grid-cols-5">
            <KpiCard label={t("kpis.views.label")} value={data?.totals.views ?? null} deltaPct={pctChange(data?.totals.views ?? null, data?.totals.prior?.views)} spark={data?.daily.map((d) => d.views)} sub={t("kpis.views.sub")} loading={loading} />
            <KpiCard label={t("kpis.reach.label")} value={data?.totals.reach ?? null} deltaPct={pctChange(data?.totals.reach ?? null, data?.totals.prior?.reach)} spark={data?.daily.map((d) => d.reach)} sub={t("kpis.reach.sub")} loading={loading} />
            <KpiCard label={t("kpis.engagement.label")} value={data?.totals.engagements ?? null} deltaPct={pctChange(data?.totals.engagements ?? null, data?.totals.prior?.engagements)} spark={data?.daily.map((d) => d.engagements)} sub={t("kpis.engagement.sub")} loading={loading} />
            <KpiCard label={t("kpis.engagementRate.label")} value={engagementRate.value} format="percent" deltaPct={engagementRate.delta} sub={engagementRate.byReach ? t("kpis.engagementRate.sub") : t("kpis.engagementRate.subViews")} loading={loading} />
            <KpiCard label={t("kpis.followers.label")} value={data?.totals.followers ?? null} deltaAbsolute={data?.totals.followerDelta} spark={followerSpark} sub={t("kpis.followers.sub")} loading={loading} />
          </StatGrid>

          {data && data.insights.length > 0 && (
            <Section bordered>
              <ul className="m-0 list-none divide-y divide-border p-0">
                {data.insights.map((insight) => (
                  <li key={insight.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-mk-ink-60" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[13px] leading-5 text-foreground">{insight.text}</p>
                      <p className="m-0 mt-0.5 text-xs text-muted-foreground">{t("insights.basedOn", { count: insight.sampleSize })}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Section
              title={t("trend.eyebrow", { days: data?.window.days ?? days })}
              description={trendTitle}
              bordered
              contentClassName="p-4 sm:p-5"
            >
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Tabs value={trendMetric} onValueChange={(v) => setTrendMetric(v as TrendMetric)}>
                    <TabsList className="h-8">
                      {TREND_METRIC_KEYS.map((key) => (
                        <TabsTrigger key={key} value={key} className="px-2.5 text-xs">{t(`trend.metrics.${key}`)}</TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <Tabs value={trendMode} onValueChange={(v) => setTrendMode(v as TrendMode)}>
                    <TabsList className="h-8">
                      {(["publish", "activity"] as const).map((mode) => (
                        <TabsTrigger key={mode} value={mode} className="px-2.5 text-xs" title={t(`trend.modeTitles.${mode}`)}>
                          {t(`trend.modes.${mode}`)}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <label className={cn("inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium", trendMode === "activity" ? "text-mk-ink-40" : "text-muted-foreground")}>
                    <input type="checkbox" checked={compare} disabled={trendMode === "activity"} onChange={(event) => setCompare(event.target.checked)} className="size-3.5 rounded border-border accent-[var(--mk-ink)]" />
                    {t("trend.compare")}
                  </label>
                </div>
              </div>
              {loading ? (
                <Skeleton className="h-[220px] w-full rounded-lg" />
              ) : activityUnavailable ? (
                <div className="flex h-[220px] items-center justify-center px-6 text-center text-[13px] text-muted-foreground">{t("trend.activityEmpty")}</div>
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
                  <p className="m-0 mt-2 text-xs text-muted-foreground">
                    {trendMode === "activity" ? t("trend.noteActivity") : t("trend.note")}
                  </p>
                </>
              )}
            </Section>
            <Section
              title={t("audience.eyebrow")}
              description={data?.totals.followers !== null && data?.totals.followers !== undefined
                ? t("audience.titleWithCount", { count: fmtCount(data.totals.followers, locale) })
                : t("audience.title")}
              bordered
              contentClassName="p-4 sm:p-5"
            >
              {loading ? <Skeleton className="h-[200px] w-full rounded-lg" /> : <FollowerTrendChart data={data?.followerTrend ?? []} locale={locale} />}
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
            <Section title={t("breakdown.title")} description={t("breakdown.eyebrow")} bordered contentClassName="p-4 sm:p-5">
              {loading || !data ? <Skeleton className="h-[170px] w-full rounded-lg" /> : <EngagementBreakdown breakdown={data.breakdown} />}
            </Section>
            <Section title={t("timing.title")} description={t("timing.eyebrow")} bordered contentClassName="p-4 sm:p-5">
              {loading ? (
                <Skeleton className="h-[170px] w-full rounded-lg" />
              ) : (
                <BestTimeHeatmap engagements={data?.heatmap.engagements ?? []} posts={data?.heatmap.posts ?? []} sampleSize={data?.heatmap.sampleSize ?? 0} />
              )}
            </Section>
            <Section title={t("format.title")} description={t("format.eyebrow")} bordered contentClassName="p-4 sm:p-5">
              {loading ? <Skeleton className="h-[170px] w-full rounded-lg" /> : <ContentTypeBars contentTypes={data?.contentTypes ?? []} />}
            </Section>
          </div>

          <Section title={t("channels.title")} description={t("channels.eyebrow")} bordered contentClassName="px-4 pb-2 sm:px-5">
            {loading ? <Skeleton className="m-4 h-[160px] w-auto rounded-lg" /> : <ChannelTable channels={data?.channels ?? []} activeChannel={channel} onSelect={setChannel} />}
          </Section>

          <Section title={t("posts.title")} description={t("posts.eyebrow")} bordered contentClassName="px-4 pb-2 sm:px-5">
            {loading ? <Skeleton className="m-4 h-[240px] w-auto rounded-lg" /> : <LeaderboardTable rows={data?.leaderboard ?? []} />}
          </Section>

          {data && (
            <p className="m-0 text-xs leading-5 text-muted-foreground">
              {t("provenance.base")}
              {data.coverage.truncated && t("provenance.truncated", { count: data.coverage.postsAnalyzed })}
              {data.coverage.lastMetricsAt && t("provenance.lastUpdate", { date: new Date(data.coverage.lastMetricsAt).toLocaleString(locale) })}
            </p>
          )}
        </div>
      )}
    </>
  );
}
