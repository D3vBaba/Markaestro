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
    ? "—"
    : format === "percent"
      ? `${(value * 100).toFixed(1)}%`
      : fmtCount(value, locale);

  return (
    <div
      className="rounded-xl p-3 sm:p-4 min-w-0"
      style={{ background: "var(--mk-paper)", border: "1px solid var(--mk-rule)" }}
    >
      <div className="mk-eyebrow">{label}</div>
      {loading ? (
        <>
          <Skeleton className="mt-2 sm:mt-2.5 h-7 sm:h-8 w-16" />
          <Skeleton className="mt-1.5 h-3 w-24" />
        </>
      ) : (
        <>
          <div className="mt-1.5 sm:mt-2 flex items-baseline gap-2 flex-wrap">
            <span
              className="text-[22px] sm:text-[26px] font-semibold mk-figure"
              style={{ color: "var(--mk-ink)" }}
            >
              {display}
            </span>
            {deltaPct !== undefined && deltaPct !== null && value !== null && (
              <Delta value={Math.round(deltaPct)} />
            )}
            {deltaAbsolute !== undefined && deltaAbsolute !== null && value !== null && (
              <span
                className="font-mono text-[11px]"
                style={{
                  color: deltaAbsolute === 0
                    ? "var(--mk-ink-40)"
                    : deltaAbsolute > 0 ? "var(--mk-pos)" : "var(--mk-neg)",
                }}
              >
                {deltaAbsolute > 0 ? "▲" : deltaAbsolute < 0 ? "▼" : "·"} {fmtCount(Math.abs(deltaAbsolute), locale)}
              </span>
            )}
          </div>
          {spark && spark.length > 1 && value !== null && (
            <div className="mt-2">
              <Spark data={spark} height={22} color="var(--mk-ink-40)" />
            </div>
          )}
          {sub && (
            <div
              className="mt-1 text-[10.5px] sm:text-[11px] font-mono truncate"
              style={{ color: "var(--mk-ink-40)", letterSpacing: "0.04em" }}
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
