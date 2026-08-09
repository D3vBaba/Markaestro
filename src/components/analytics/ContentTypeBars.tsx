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
      <div
        className="flex flex-col items-center justify-center text-center py-10 px-6 gap-1"
        style={{ color: "var(--mk-ink-60)" }}
      >
        <p className="text-[13px] font-medium m-0" style={{ color: "var(--mk-ink)" }}>
          {t("notEnoughVariety")}
        </p>
        <p className="text-[12px] m-0">
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
                <span className="text-[12.5px]" style={{ color: "var(--mk-ink)" }}>
                  {t.has(`types.${ct.type}`) ? t(`types.${ct.type}`) : ct.type}
                  <span className="font-mono text-[10.5px] ml-1.5" style={{ color: "var(--mk-ink-40)" }}>
                    {t("postsCount", { count: ct.posts })}
                  </span>
                </span>
                <span className="font-mono text-[12px] mk-figure" style={{ color: "var(--mk-ink)" }}>
                  {fmtCount(Math.round(ct.avgEngagements ?? 0), locale)}
                  <span style={{ color: "var(--mk-ink-40)" }}> {t("avgEng")}</span>
                </span>
              </div>
              <div
                className="h-2 rounded-[3px] overflow-hidden"
                style={{ background: "var(--mk-rule-soft)" }}
              >
                <div
                  className="h-full rounded-[3px]"
                  style={{ width: `${pct}%`, background: "var(--mk-ink)" }}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}
