"use client";

import { Heatmap } from "@/components/mk/Heatmap";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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
  if (sampleSize < MIN_SAMPLE) {
    return (
      <div
        className="flex flex-col items-center justify-center text-center py-10 px-6 gap-1"
        style={{ color: "var(--mk-ink-60)" }}
      >
        <p className="text-[13px] font-medium m-0" style={{ color: "var(--mk-ink)" }}>
          Not enough data yet
        </p>
        <p className="text-[12px] m-0">
          The posting-time heatmap unlocks once {MIN_SAMPLE} posts have engagement data
          ({sampleSize} so far).
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
      <Heatmap data={avg} days={DAYS} hours={HOURS} max={max} height={170} />
      <p
        className="mt-2.5 mb-0 text-[10.5px] font-mono"
        style={{ color: "var(--mk-ink-40)", letterSpacing: "0.04em" }}
      >
        AVG ENGAGEMENT PER POST · YOUR LOCAL TIME · {sampleSize} POSTS
      </p>
    </div>
  );
}
