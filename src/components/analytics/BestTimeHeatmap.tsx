"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Heatmap } from "@/components/mk/Heatmap";

// 2024-01-01 was a Monday — anchor for computing locale-aware short weekday
// abbreviations in Mon-first order without hardcoding English day names.
const WEEK_ANCHOR = new Date("2024-01-01T00:00:00Z");
const HOURS = Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? String(h) : ""));
const MIN_SAMPLE = 10;

/**
 * Average engagement per post by publish day × hour (viewer's timezone).
 * Hidden behind an honest empty state until there's a usable sample.
 */
export function BestTimeHeatmap({
  engagements,
  posts,
  sampleSize,
}: {
  engagements: number[][];
  posts: number[][];
  sampleSize: number;
}) {
  const t = useTranslations("analytics.bestTimeHeatmap");
  const locale = useLocale();
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(WEEK_ANCHOR);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
      }),
    [locale],
  );

  if (sampleSize < MIN_SAMPLE) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center text-slate-500 dark:text-slate-400">
        <p className="m-0 text-[13px] font-medium text-slate-900 dark:text-slate-100">
          {t("notEnoughData")}
        </p>
        <p className="m-0 text-[12px]">
          {t("unlocksAt", { min: MIN_SAMPLE, sampleSize })}
        </p>
      </div>
    );
  }

  // Average engagement per post per cell — totals would just mirror volume.
  const avg = engagements.map((row, d) =>
    row.map((total, h) => (posts[d]?.[h] ? total / posts[d][h] : 0)),
  );
  const max = Math.max(1, ...avg.flat());

  return (
    <div>
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <div className="min-w-[480px]">
          <Heatmap data={avg} days={days} hours={HOURS} max={max} height={170} />
        </div>
      </div>
      <p className="mb-0 mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {t("footer", { count: sampleSize })}
      </p>
    </div>
  );
}
