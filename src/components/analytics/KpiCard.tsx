"use client";

import { useLocale } from "next-intl";
import { StatTile } from "@/components/app/StatTile";
import { fmtCount } from "@/components/mk/format";

/**
 * Overview stat: label, value, delta vs prior period, sparkline.
 * `value === null` renders "n/a" (metric unavailable), never 0.
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
  deltaPct?: number | null;
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

  const trailing =
    deltaAbsolute !== undefined && deltaAbsolute !== null && value !== null ? (
      <span
        className={`text-xs font-medium tabular-nums ${
          deltaAbsolute === 0
            ? "text-mk-ink-40"
            : deltaAbsolute > 0 ? "text-mk-pos" : "text-mk-neg"
        }`}
      >
        {deltaAbsolute > 0 ? "+" : deltaAbsolute < 0 ? "-" : ""}{fmtCount(Math.abs(deltaAbsolute), locale)}
      </span>
    ) : null;

  return (
    <StatTile
      label={label}
      value={display}
      deltaPct={value !== null ? deltaPct : null}
      trailing={trailing}
      spark={value !== null ? spark : undefined}
      sub={sub}
      loading={loading}
    />
  );
}
