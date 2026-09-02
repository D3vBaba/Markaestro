"use client";

import { useLocale, useTranslations } from "next-intl";
import { fmtCount } from "@/components/mk/format";
import type { EngagementBreakdown as Breakdown } from "@/lib/analytics/api-shape";

const KEYS = ["likes", "comments", "shares", "saves", "clicks"] as const;

function pct(current: number | null, prior: number | null | undefined): number | null {
  if (current === null || prior === null || prior === undefined || prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

/** What people did with the posts in the window: one bar per interaction, with share and prior-period change. */
export function EngagementBreakdown({ breakdown }: { breakdown: Breakdown & { prior: Breakdown | null } }) {
  const t = useTranslations("analytics.breakdown");
  const locale = useLocale();
  const rows = KEYS.map((key) => ({ key, value: breakdown[key], prior: breakdown.prior?.[key] ?? null }))
    .filter((row) => row.value !== null);
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">{t("empty")}</p>;
  }
  // Clicks are not engagement; the share is over the four interaction kinds.
  const engagementTotal = rows.filter((row) => row.key !== "clicks").reduce((sum, row) => sum + (row.value ?? 0), 0);
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const change = pct(row.value, row.prior);
        const share = row.key === "clicks" || engagementTotal === 0 ? null : Math.round(((row.value ?? 0) / engagementTotal) * 100);
        return (
          <li key={row.key} className="min-w-0">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-slate-700 dark:text-slate-200">
                {t(`types.${row.key}`)}
                {share !== null && <span className="ms-1.5 text-[11px] text-slate-400 dark:text-slate-500">{t("share", { pct: share })}</span>}
              </span>
              <span className="flex items-baseline gap-2 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {fmtCount(Math.round(row.value ?? 0), locale)}
                {change !== null && (
                  <span className={`text-[11px] font-semibold ${change > 0 ? "text-emerald-600 dark:text-emerald-400" : change < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400"}`}>
                    {change > 0 ? "+" : ""}{change}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-[3px] bg-slate-100 dark:bg-slate-800">
              <div className={`h-full rounded-[3px] ${row.key === "clicks" ? "bg-blue-500" : "bg-slate-800 dark:bg-slate-200"}`} style={{ width: `${Math.max(3, Math.round(((row.value ?? 0) / max) * 100))}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
