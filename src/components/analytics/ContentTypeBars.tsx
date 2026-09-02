"use client";

import { useLocale, useTranslations } from "next-intl";
import { fmtCount } from "@/components/mk/format";
import type { AnalyticsResponse } from "@/lib/analytics/api-shape";

/** Average engagement per post by content format — answers "what should I post more of?". */
export function ContentTypeBars({ contentTypes }: { contentTypes: AnalyticsResponse["contentTypes"] }) {
  const t = useTranslations("analytics.contentTypeBars");
  const locale = useLocale();
  const withData = contentTypes.filter((ct) => ct.avgEngagements !== null);
  if (withData.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center text-slate-500 dark:text-slate-400">
        <p className="m-0 text-[13px] font-medium text-slate-900 dark:text-slate-100">
          {t("notEnoughVariety")}
        </p>
        <p className="m-0 text-[12px]">
          {t("publishAtLeastTwo")}
        </p>
      </div>
    );
  }

  const max = Math.max(...withData.map((ct) => ct.avgEngagements ?? 0), 1);

  return (
    <div className="flex flex-col gap-3">
      {withData
        .sort((a, b) => (b.avgEngagements ?? 0) - (a.avgEngagements ?? 0))
        .map((ct) => {
          const pct = Math.max(3, Math.round(((ct.avgEngagements ?? 0) / max) * 100));
          return (
            <div key={ct.type} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-[13px] text-slate-700 dark:text-slate-200">
                  {t.has(`types.${ct.type}`) ? t(`types.${ct.type}`) : ct.type}
                  <span className="ms-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    {t("postsCount", { count: ct.posts })}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {fmtCount(Math.round(ct.avgEngagements ?? 0), locale)}
                  <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500"> {t("avgEng")}</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-[3px] bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-[3px] bg-slate-800 dark:bg-slate-200" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
    </div>
  );
}
