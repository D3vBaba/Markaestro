"use client";

import { useTranslations } from "next-intl";
import { Target } from "lucide-react";
import { KpiCard } from "@/components/analytics/KpiCard";
import { ReadinessPanel } from "./ReadinessPanel";
import { ChannelDot, EmptyState, Section, TabHeader, TrustBadge } from "./shared";
import { useIntelligenceFormat } from "./format";
import type { IntelligenceOverview } from "./types";

export function OverviewTab({
  data,
  onNavigate,
}: {
  data: IntelligenceOverview;
  onNavigate: (tab: string) => void;
}) {
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();
  const totals = data.totals;
  const objective = data.objective;
  const metricName = fmt.metricName(objective?.metric);
  const engagements = totals
    ? [totals.likes, totals.comments, totals.shares, totals.saves].some((value) => typeof value === "number")
      ? [totals.likes, totals.comments, totals.shares, totals.saves].reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0)
      : null
    : null;
  const coverage = (key: string) => (totals?.coverage[key] !== undefined ? t("coverage", { value: totals.coverage[key] }) : undefined);

  return (
    <div className="space-y-4 sm:space-y-5">
      <TabHeader topic="overview" title={t("howItWorks.overview.title")} body={t("howItWorks.overview.intro")} />

      {objective && (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 dark:border-slate-800/80 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Target className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <TrustBadge kind="declared" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("objective.title")}</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t(`objective.names.${objective.objective}`)}
                </span>
              </div>
              {!objective.fallback && (
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {t("objective.body", { metric: metricName, objective: t(`objective.names.${objective.objective}`) })}
                </p>
              )}
              {objective.fallback && (
                <p className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  {t("objective.fallback", { requested: t(`objective.names.${objective.requested}`), metric: metricName })}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("audience")}
            className="shrink-0 self-start text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400 sm:self-center"
          >
            {t("objective.change")}
          </button>
        </div>
      )}

      {totals && totals.posts === 0 ? (
        <EmptyState title={t("empty.overviewTitle")} body={t("empty.overviewBody")} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard label={t("metrics.posts")} value={totals?.posts ?? 0} />
          <KpiCard label={t("metrics.views")} value={totals?.views ?? null} sub={coverage("views")} />
          <KpiCard label={t("metrics.reach")} value={totals?.reach ?? null} sub={coverage("reach")} />
          <KpiCard label={t("metrics.engagements")} value={engagements} sub={coverage("likes")} />
          <KpiCard label={t("metrics.clicks")} value={totals?.clicks ?? null} sub={coverage("clicks")} />
          <KpiCard label={t("metrics.conversions")} value={totals?.conversions ?? null} sub={coverage("conversions")} />
        </div>
      )}

      {data.readiness && (
        <ReadinessPanel readiness={data.readiness} objectiveMetric={objective?.metric || "views"} computedAt={data.computedAt} />
      )}

      <Section trust="calculated" title={t("platforms.title")} subtitle={t("platforms.subtitle")}>
        {data.channels.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("platforms.empty")}</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            <div className="hidden grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))] gap-3 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 sm:grid">
              <span>{t("platforms.colPlatform")}</span>
              <span className="text-end">{t("platforms.colPosts")}</span>
              <span className="text-end">{t("platforms.colAvgViews")}</span>
              <span className="text-end">{t("platforms.colAvgEngagements")}</span>
              <span className="text-end">{t("platforms.colEngRate")}</span>
            </div>
            {data.channels.map((channel) => {
              const measured = Math.max(channel.measuredViews ?? 0, channel.measuredEngagements ?? 0);
              const cell = (label: string, value: string) => (
                <div className="flex justify-between sm:block sm:text-end">
                  <span className="text-xs text-slate-400 sm:hidden">{label}</span>
                  <span className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</span>
                </div>
              );
              return (
                <div
                  key={channel.platform}
                  className="grid grid-cols-1 gap-1 py-3 text-xs sm:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))] sm:items-center sm:gap-3"
                >
                  <div className="min-w-0">
                    <ChannelDot platform={channel.platform} />
                    <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                      {t("platforms.measuredNote", { measured, posts: channel.posts })}
                    </p>
                  </div>
                  {cell(t("platforms.colPosts"), String(channel.posts))}
                  {cell(t("platforms.colAvgViews"), fmt.metric(channel.avgViews ?? null))}
                  {cell(t("platforms.colAvgEngagements"), fmt.metric(channel.avgEngagements ?? null))}
                  {cell(t("platforms.colEngRate"), fmt.rate(channel.engagementRate ?? null))}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">{t("platforms.includesImported")}</p>
      </Section>

      {data.alignment && data.alignment.score !== null && (
        <Section trust="calculated" title={t("alignment.title")}>
          <div className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold text-slate-900 dark:text-slate-100">{data.alignment.score}</span>
              <span className="text-xs font-semibold text-slate-400">{t("coverage", { value: data.alignment.coverage })}</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {Object.entries(data.alignment.dimensions).map(([name, value]) => (
                <div key={name} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                  <span className="font-medium text-slate-600 dark:text-slate-400">{t(`alignment.dimensions.${name as "geography"}`)}</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{value === null ? "n/a" : value}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
