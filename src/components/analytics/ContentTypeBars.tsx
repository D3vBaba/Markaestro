"use client";

import { fmtCount } from "@/components/mk/format";
import type { AnalyticsResponse } from "@/lib/analytics/api-shape";

const TYPE_LABELS: Record<string, string> = {
  image: "Images",
  video: "Videos",
  carousel: "Carousels",
  text: "Text posts",
};

/** Average engagement per post by content format — answers "what should I post more of?". */
export function ContentTypeBars({ contentTypes }: { contentTypes: AnalyticsResponse["contentTypes"] }) {
  const withData = contentTypes.filter((t) => t.avgEngagements !== null);
  if (withData.length < 2) {
    return (
      <div
        className="flex flex-col items-center justify-center text-center py-10 px-6 gap-1"
        style={{ color: "var(--mk-ink-60)" }}
      >
        <p className="text-[13px] font-medium m-0" style={{ color: "var(--mk-ink)" }}>
          Not enough variety yet
        </p>
        <p className="text-[12px] m-0">
          Publish at least two content formats (images, videos, carousels, text) to compare them.
        </p>
      </div>
    );
  }

  const max = Math.max(...withData.map((t) => t.avgEngagements ?? 0), 1);

  return (
    <div className="flex flex-col gap-3">
      {withData
        .sort((a, b) => (b.avgEngagements ?? 0) - (a.avgEngagements ?? 0))
        .map((t) => {
          const pct = Math.max(3, Math.round(((t.avgEngagements ?? 0) / max) * 100));
          return (
            <div key={t.type} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-[12.5px]" style={{ color: "var(--mk-ink)" }}>
                  {TYPE_LABELS[t.type] ?? t.type}
                  <span className="font-mono text-[10.5px] ml-1.5" style={{ color: "var(--mk-ink-40)" }}>
                    {t.posts} {t.posts === 1 ? "post" : "posts"}
                  </span>
                </span>
                <span className="font-mono text-[12px] mk-figure" style={{ color: "var(--mk-ink)" }}>
                  {fmtCount(Math.round(t.avgEngagements ?? 0))}
                  <span style={{ color: "var(--mk-ink-40)" }}> avg eng.</span>
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
