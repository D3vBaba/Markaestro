"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/app/PageHeader";
import Section from "@/components/app/Section";
import Notice from "@/components/app/Notice";
import EmptyState from "@/components/app/EmptyState";
import { StatGrid, StatTile } from "@/components/app/StatTile";
import { DashboardOverviewChart } from "@/components/dashboard/OverviewChart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Status } from "@/components/mk/Status";
import { Channel } from "@/components/mk/Channel";
import { PostThumbnail } from "@/components/mk/PostThumbnail";
import { channelLabel } from "@/components/mk/channels";
import { fmtCount } from "@/components/mk/format";
import { cn } from "@/lib/utils";
import { AlertCircle, ChevronRight, Plus, RefreshCw, Send } from "lucide-react";

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
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
};

type DashboardData = {
  metrics: DashboardMetrics;
  dailyPosts: DailyPost[];
  recentPosts: RecentPost[];
};

const SERIES = [
  { key: "published", dot: "bg-mk-pos" },
  { key: "scheduled", dot: "bg-mk-accent" },
] as const;

export default function Home() {
  const { data, loading, refreshing, error, refresh } =
    useApiQuery<DashboardData>("/api/dashboard");
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const tStatus = useTranslations("appCommon.status");

  const dailyPosts = data?.dailyPosts ?? [];
  const recentPosts = data?.recentPosts ?? [];
  const m = data?.metrics ?? null;
  const publishedTotal = dailyPosts.reduce((a, d) => a + (d.published || 0), 0);
  const failed = Boolean(error && !loading);

  const toggleSeries = (key: string) =>
    setHiddenSeries((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const channelRows = Object.entries(m?.postsByChannel ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const channelTotal = channelRows.reduce((a, [, c]) => a + c, 0);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => refresh()} disabled={loading || refreshing}>
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
              {refreshing ? t("refreshing") : t("refresh")}
            </Button>
            <Button size="sm" asChild>
              <Link href="/content">
                <Plus className="size-4" />
                {t("newPost")}
              </Link>
            </Button>
          </>
        }
      />

      {failed ? (
        <Notice
          tone="negative"
          icon={AlertCircle}
          title={t("errorTitle")}
          action={
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              {t("retry")}
            </Button>
          }
        >
          {t("errorBody")}
        </Notice>
      ) : (
        <div className="space-y-10">
          {!loading && m !== null && m.totalProducts === 0 ? (
            <Notice
              tone="accent"
              title={t("firstRun.title")}
              action={
                <Button size="sm" asChild>
                  <Link href="/products">
                    <Plus className="size-4" />
                    {t("firstRun.cta")}
                  </Link>
                </Button>
              }
            >
              {t("firstRun.body")}
            </Notice>
          ) : null}

          <StatGrid columns={3}>
            <StatTile
              label={t("kpis.brands")}
              value={fmtCount(m?.totalProducts ?? 0, locale)}
              sub={t("kpis.brandsActive", { count: m?.activeProducts ?? 0 })}
              loading={loading}
            />
            <StatTile
              label={t("kpis.posts")}
              value={fmtCount(m?.totalPosts ?? 0, locale)}
              sub={t("kpis.postsSub", { published: m?.publishedPosts ?? 0, scheduled: m?.scheduledPosts ?? 0 })}
              loading={loading}
            />
            <StatTile
              label={t("kpis.publishedWeek")}
              value={fmtCount(publishedTotal, locale)}
              sub={t("kpis.acrossDays", { count: dailyPosts.length })}
              loading={loading}
            />
          </StatGrid>

          <div className="grid grid-cols-1 items-start gap-10 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-10">
              <Section
                title={t("chart.eyebrow")}
                description={loading ? undefined : t("chart.publishedThisWeek", { count: fmtCount(publishedTotal, locale) })}
                action={
                  <div className="flex items-center gap-1">
                    {SERIES.map((s) => {
                      const hidden = hiddenSeries.includes(s.key);
                      return (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() => toggleSeries(s.key)}
                          aria-pressed={!hidden}
                          aria-label={hidden ? t("chart.show", { label: tStatus(s.key) }) : t("chart.hide", { label: tStatus(s.key) })}
                          className={cn(
                            "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
                            hidden ? "text-mk-ink-40 hover:text-foreground" : "bg-muted text-foreground",
                          )}
                        >
                          <span className={cn("size-2 rounded-full", hidden ? "bg-mk-ink-20" : s.dot)} />
                          {tStatus(s.key)}
                        </button>
                      );
                    })}
                  </div>
                }
                bordered
                contentClassName="p-4 sm:p-5"
              >
                {loading ? (
                  <Skeleton className="h-[240px] w-full rounded-lg" />
                ) : (
                  <DashboardOverviewChart data={dailyPosts} height={240} hiddenSeries={hiddenSeries} />
                )}
              </Section>

              {channelRows.length > 0 ? (
                <Section title={t("distribution.title")} bordered>
                  <ul className="m-0 list-none divide-y divide-border p-0">
                    {channelRows.map(([ch, count]) => {
                      const pct = channelTotal > 0 ? Math.round((count / channelTotal) * 100) : 0;
                      return (
                        <li key={ch}>
                          <Link
                            href={`/calendar?channel=${encodeURIComponent(ch)}`}
                            aria-label={t("distribution.viewInCalendar", { channel: channelLabel(ch) })}
                            className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 sm:px-5"
                          >
                            <Channel channel={ch} size={24} />
                            <div className="min-w-0 flex-1">
                              <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
                                <span className="font-medium text-foreground">{channelLabel(ch)}</span>
                                <span className="tabular-nums text-muted-foreground">
                                  {fmtCount(count, locale)}
                                  <span className="ms-1.5 text-mk-ink-40">{pct}%</span>
                                </span>
                              </div>
                              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full w-full origin-left rounded-full bg-foreground rtl:origin-right"
                                  style={{ transform: `scaleX(${pct / 100})` }}
                                />
                              </div>
                            </div>
                            <ChevronRight className="size-4 shrink-0 text-mk-ink-40 transition-colors group-hover:text-foreground rtl:rotate-180" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              ) : null}
            </div>

            <Section
              title={t("recentPosts.title")}
              action={
                <Link href="/calendar" className="text-[13px] font-medium text-mk-accent hover:underline underline-offset-4">
                  {t("recentPosts.viewAll")}
                </Link>
              }
              bordered
              className="min-w-0"
            >
              {loading ? (
                <div className="divide-y divide-border">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3">
                      <Skeleton className="size-6 shrink-0 rounded-md" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-full" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentPosts.length > 0 ? (
                <ul className="m-0 max-h-[480px] list-none divide-y divide-border overflow-y-auto p-0">
                  {recentPosts.map((post) => (
                    <li key={post.id}>
                      <Link
                        href={`/calendar?post=${post.id}`}
                        className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                      >
                        <PostThumbnail src={post.thumbnailUrl} mediaUrl={post.mediaUrl} channel={post.channel} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="m-0 line-clamp-2 text-[13px] leading-5 text-foreground">
                            {post.content || t("recentPosts.untitled")}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <Status value={post.status} />
                            {post.date ? (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {new Date(post.date).toLocaleDateString(locale, { month: "short", day: "numeric" })}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={Send}
                  title={t("recentPosts.empty")}
                  className="rounded-none border-0"
                  action={
                    <Button size="sm" asChild>
                      <Link href="/content">
                        <Plus className="size-4" />
                        {t("newPost")}
                      </Link>
                    </Button>
                  }
                />
              )}
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
