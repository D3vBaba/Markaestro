"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/app/PageHeader";
import { DashboardOverviewChart } from "@/components/dashboard/OverviewChart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Status } from "@/components/mk/Status";
import { Channel } from "@/components/mk/Channel";
import { channelLabel } from "@/components/mk/channels";
import { fmtCount } from "@/components/mk/format";
import {
  AlertCircle,
  ChevronRight,
  Plus,
  RefreshCw,
  Package,
  Send,
  Calendar as CalendarIcon,
} from "lucide-react";

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

type DashboardData = {
  metrics: DashboardMetrics;
  dailyPosts: DailyPost[];
  recentPosts: RecentPost[];
};

export default function Home() {
  const { data, loading, refreshing, error, refresh } =
    useApiQuery<DashboardData>("/api/dashboard");
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const tStatus = useTranslations("appCommon.status");

  const dailyPosts = data?.dailyPosts ?? [];
  const recentPosts = data?.recentPosts ?? [];

  const toggleSeries = (key: string) =>
    setHiddenSeries((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const m = data?.metrics ?? null;
  const publishedTotal = dailyPosts.reduce((a, d) => a + (d.published || 0), 0);

  const kpis = [
    {
      key: "products",
      label: t("kpis.brands"),
      value: fmtCount(m?.totalProducts ?? 0, locale),
      sub: t("kpis.brandsActive", { count: m?.activeProducts ?? 0 }),
      icon: Package,
    },
    {
      key: "posts",
      label: t("kpis.posts"),
      value: fmtCount(m?.totalPosts ?? 0, locale),
      sub: t("kpis.postsSub", { published: m?.publishedPosts ?? 0, scheduled: m?.scheduledPosts ?? 0 }),
      icon: Send,
    },
    {
      key: "week",
      label: t("kpis.publishedWeek"),
      value: fmtCount(publishedTotal, locale),
      sub: t("kpis.acrossDays", { count: dailyPosts.length }),
      icon: CalendarIcon,
    },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              variant="outline"
              className="rounded-xl h-9 text-xs font-medium gap-2 border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => refresh()}
              disabled={loading || refreshing}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? t("refreshing") : t("refresh")}
            </Button>
            <Link href="/content">
              <Button className="rounded-xl h-9 text-xs font-semibold gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-xs">
                <Plus className="h-4 w-4" />
                {t("newPost")}
              </Button>
            </Link>
          </div>
        }
      />

      {error && !loading && (
        <div className="flex items-start gap-3 rounded-2xl p-4 mb-6 bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-rose-900 dark:text-rose-200 m-0">
              {t("errorTitle")}
            </p>
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-0.5 m-0">
              {t("errorBody")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs shrink-0 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100/50"
            onClick={() => refresh()}
          >
            {t("retry")}
          </Button>
        </div>
      )}

      {!(error && !loading) && (
        <div className="space-y-6">
          {!loading && m !== null && m.totalProducts === 0 && (
            <div className="flex flex-col gap-3 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/50">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 m-0">{t("firstRun.title")}</p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5 m-0">{t("firstRun.body")}</p>
              </div>
              <Link href="/products" className="shrink-0">
                <Button className="rounded-xl h-9 text-xs font-semibold gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-xs">
                  <Plus className="h-4 w-4" />
                  {t("firstRun.cta")}
                </Button>
              </Link>
            </div>
          )}
          {/* KPI Row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {kpis.map((kpi) => {
              const Icon = kpi.icon;
              return (
                <div
                  key={kpi.key}
                  className="rounded-2xl p-5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {kpi.label}
                    </span>
                    <div className="h-9 w-9 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  {loading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-24 rounded-lg" />
                      <Skeleton className="h-3.5 w-32 rounded-md" />
                    </div>
                  ) : (
                    <div>
                      <div className="text-3xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-slate-50">
                        {kpi.value}
                      </div>
                      <div className="mt-1 text-xs text-slate-400 font-medium">
                        {kpi.sub}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Main 2-Column Content Area */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
            {/* Left Column: Activity Chart & Distribution */}
            <div className="flex flex-col gap-6 min-w-0">
              {/* Overview Activity Area Chart */}
              <div className="rounded-2xl p-5 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
                <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {t("chart.eyebrow")}
                    </div>
                    {loading ? (
                      <Skeleton className="mt-1.5 h-6 w-48 rounded-lg" />
                    ) : (
                      <div className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span>{t("chart.publishedThisWeek", { count: fmtCount(publishedTotal, locale) })}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {[
                      { key: "published", label: tStatus("published"), color: "#10b981", bg: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50" },
                      { key: "scheduled", label: tStatus("scheduled"), color: "#2563eb", bg: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/50" },
                    ].map((s) => {
                      const hidden = hiddenSeries.includes(s.key);
                      return (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() => toggleSeries(s.key)}
                          aria-pressed={!hidden}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border cursor-pointer ${
                            hidden
                              ? "opacity-40 line-through bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"
                              : `${s.bg} hover:opacity-90`
                          }`}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: hidden ? "#94a3b8" : s.color }}
                          />
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {loading ? (
                  <Skeleton className="w-full rounded-xl" style={{ height: 240 }} />
                ) : (
                  <DashboardOverviewChart
                    data={dailyPosts}
                    height={240}
                    hiddenSeries={hiddenSeries}
                  />
                )}
              </div>

              {/* Social Channel Distribution */}
              {m?.postsByChannel && Object.keys(m.postsByChannel).length > 0 && (
                <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
                  <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {t("distribution.eyebrow")}
                      </div>
                      <div className="mt-0.5 text-base font-bold text-slate-900 dark:text-slate-100">
                        {t("distribution.title")}
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {Object.entries(m.postsByChannel)
                      .sort((a, b) => b[1] - a[1])
                      .map(([ch, count], _, arr) => {
                        const total = arr.reduce((a, [, v]) => a + v, 0) || 1;
                        const pct = Math.round((count / total) * 100);
                        return (
                          <Link
                            key={ch}
                            href={`/calendar?channel=${encodeURIComponent(ch)}`}
                            title={t("distribution.viewInCalendar", { channel: channelLabel(ch) })}
                            className="group flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          >
                            <Channel channel={ch} size={24} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between text-xs mb-1.5">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  {channelLabel(ch)}
                                </span>
                                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                                  {fmtCount(count, locale)} posts ({pct}%)
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full w-full rounded-full bg-blue-600 dark:bg-blue-500 origin-left rtl:origin-right transition-transform duration-300 ease-out-quart"
                                  style={{ transform: `scaleX(${pct / 100})` }}
                                />
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 group-hover:translate-x-0.5 transition-[color,transform] duration-150" />
                          </Link>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* Right Rail: Recent Posts & Quick Actions */}
            <div className="flex flex-col gap-6 min-w-0">
              <div className="rounded-2xl p-5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {t("recentPosts.eyebrow")}
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 m-0">
                      {t("recentPosts.title")}
                    </h3>
                  </div>
                  <Link
                    href="/calendar"
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    {t("recentPosts.viewAll")}
                  </Link>
                </div>

                {loading ? (
                  <div className="flex flex-col gap-3 py-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="flex items-start gap-3 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                        <Skeleton className="h-7 w-7 rounded-lg shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-full rounded" />
                          <Skeleton className="h-3 w-2/3 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : recentPosts.length > 0 ? (
                  <div className="flex flex-col gap-2.5 max-h-[420px] overflow-y-auto pr-1">
                    {recentPosts.map((post) => (
                      <Link
                        key={post.id}
                        href={`/calendar?post=${post.id}`}
                        className="group flex items-start gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 hover:bg-slate-100/70 dark:hover:bg-slate-800/70 hover:border-slate-200 dark:hover:border-slate-700 transition-colors"
                      >
                        <div className="shrink-0 mt-0.5">
                          <Channel channel={post.channel} size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium leading-snug line-clamp-2 text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            {post.content || t("recentPosts.untitled")}
                          </p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Status value={post.status} />
                            {post.date && (
                              <span className="text-[10px] text-slate-400 font-medium">
                                {new Date(post.date).toLocaleDateString(locale, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 py-4 text-center">{t("recentPosts.empty")}</p>
                )}

                <Link href="/content" className="block mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full rounded-xl text-xs font-semibold gap-1.5 h-9 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("newPost")}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


