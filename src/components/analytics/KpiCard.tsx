"use client";

import { useLocale } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { Delta } from "@/components/mk/Delta";
import { Spark } from "@/components/mk/Spark";
import { fmtCount } from "@/components/mk/format";

/**
 * Overview stat tile: label → value → delta vs prior period → sparkline.
 * `value === null` renders an honest em dash (metric unavailable), never 0.
 */
export function KpiCard({
  label,
  value,
  format = "count",
  deltaPct,
  deltaAbsolute,
  spark,
  sub,
  loading,
}: {
  label: string;
  value: number | null;
  format?: "count" | "percent";
  /** Percent change vs the prior period (e.g. 12 = +12%). */
  deltaPct?: number | null;
  /** Absolute change (e.g. follower net change). */
  deltaAbsolute?: number | null;
  spark?: number[];
  sub?: string;
  loading?: boolean;
}) {
  const locale = useLocale();
  const display = value === null
    ? "n/a"
    : format === "percent"
      ? `${(value * 100).toFixed(1)}%`
      : fmtCount(value, locale);

  return (
    <div className="rounded-2xl p-4 sm:p-5 min-w-0 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
      <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{label}</div>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-3 w-28 rounded-md" />
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-slate-50">
              {display}
            </span>
            {deltaPct !== undefined && deltaPct !== null && value !== null && (
              <Delta value={Math.round(deltaPct)} />
            )}
            {deltaAbsolute !== undefined && deltaAbsolute !== null && value !== null && (
              <span
                className={`tabular-nums text-xs font-semibold ${
                  deltaAbsolute === 0
                    ? "text-slate-400"
                    : deltaAbsolute > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {deltaAbsolute > 0 ? "▲" : deltaAbsolute < 0 ? "▼" : "·"} {fmtCount(Math.abs(deltaAbsolute), locale)}
              </span>
            )}
          </div>
          {spark && spark.length > 1 && value !== null && (
            <div className="mt-3">
              <Spark data={spark} height={24} color="#2563eb" />
            </div>
          )}

          {sub && (
            <div
              className="mt-1.5 text-xs text-slate-400 font-medium truncate"
              title={sub}
            >
              {sub}
            </div>
          )}
        </>
      )}
    </div>
  );
}

