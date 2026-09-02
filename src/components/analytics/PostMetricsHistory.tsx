"use client";

import { useLocale, useTranslations } from "next-intl";
import { useApiQuery } from "@/hooks/useApiQuery";
import { fmtCount } from "@/components/mk/format";
import { Skeleton } from "@/components/ui/skeleton";
import type { PostHistoryStage } from "@/lib/analytics/history";

type HistoryResponse = {
  post: { id: string; metricsStatus: string | null; nextPollAt: string | null };
  stages: PostHistoryStage[];
};

function cell(value: number | null, locale: string): string {
  return value === null ? "n/a" : fmtCount(Math.round(value), locale);
}

function delta(value: number | null, locale: string): string {
  if (value === null) return "";
  if (value === 0) return "±0";
  return `${value > 0 ? "+" : "−"}${fmtCount(Math.abs(Math.round(value)), locale)}`;
}

/** How one post earned its numbers over time: one row per poller snapshot. */
export function PostMetricsHistory({ postId }: { postId: string }) {
  const t = useTranslations("analytics.history");
  const locale = useLocale();
  const { data, loading, error } = useApiQuery<HistoryResponse>(`/api/analytics/posts/${encodeURIComponent(postId)}/history`);

  if (loading && !data) return <Skeleton className="h-24 w-full rounded-lg" />;
  if (error || !data) return <p className="py-3 text-[12px] text-slate-500 dark:text-slate-400">{t("failed")}</p>;
  if (data.stages.length === 0) return <p className="py-3 text-[12px] text-slate-500 dark:text-slate-400">{t("empty")}</p>;

  const next = data.post.nextPollAt ? new Date(data.post.nextPollAt) : null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800/80">
            <th className="py-1.5 pe-3 text-start text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.stage")}</th>
            <th className="px-2 py-1.5 text-end text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.views")}</th>
            <th className="px-2 py-1.5 text-end text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.reach")}</th>
            <th className="px-2 py-1.5 text-end text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.engagements")}</th>
            <th className="ps-2 py-1.5 text-end text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.captured")}</th>
          </tr>
        </thead>
        <tbody>
          {data.stages.map((stage) => (
            <tr key={`${stage.stageKey}-${stage.capturedAt}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
              <td className="py-1.5 pe-3 text-slate-700 dark:text-slate-200">
                {stage.hoursAfterPublish === null
                  ? stage.stageKey
                  : stage.hoursAfterPublish < 48
                    ? t("hoursAfter", { hours: stage.hoursAfterPublish })
                    : t("daysAfter", { days: Math.round(stage.hoursAfterPublish / 24) })}
              </td>
              <td className="px-2 py-1.5 text-end tabular-nums text-slate-900 dark:text-slate-100">
                {cell(stage.views, locale)}
                {stage.viewsDelta !== null && <span className="ms-1.5 text-[10.5px] text-slate-400">{delta(stage.viewsDelta, locale)}</span>}
              </td>
              <td className="px-2 py-1.5 text-end tabular-nums text-slate-900 dark:text-slate-100">{cell(stage.reach, locale)}</td>
              <td className="px-2 py-1.5 text-end tabular-nums text-slate-900 dark:text-slate-100">
                {cell(stage.engagements, locale)}
                {stage.engagementsDelta !== null && <span className="ms-1.5 text-[10.5px] text-slate-400">{delta(stage.engagementsDelta, locale)}</span>}
              </td>
              <td className="ps-2 py-1.5 text-end tabular-nums text-slate-400 dark:text-slate-500">
                {new Date(stage.capturedAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
        {data.post.metricsStatus === "complete"
          ? t("complete")
          : next
            ? t("nextPoll", { when: next.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })
            : t("tracking")}
      </p>
    </div>
  );
}
