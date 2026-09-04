"use client";

import { useLocale, useTranslations } from "next-intl";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { isRtlLocale } from "@/i18n/routing";

type DailyPost = {
  label: string;
  published: number;
  scheduled: number;
};

const SERIES = {
  published: "var(--mk-pos)",
  scheduled: "var(--mk-accent)",
} as const;

export function DashboardOverviewChart({
  data,
  height = 240,
  hiddenSeries = [],
}: {
  data: DailyPost[];
  height?: number;
  hiddenSeries?: string[];
}) {
  const t = useTranslations("dashboard.chart");
  const tStatus = useTranslations("appCommon.status");
  const isRtl = isRtlLocale(useLocale());

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-[13px] text-muted-foreground" style={{ height }}>
        {t("noActivity")}
      </div>
    );
  }

  const tick = { fill: "var(--mk-ink-40)", fontSize: 11, fontWeight: 500 };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" reversed={isRtl} tickLine={false} axisLine={false} dy={8} tick={tick} />
        <YAxis
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={40}
          orientation={isRtl ? "right" : "left"}
          tick={tick}
        />
        <CartesianGrid vertical={false} stroke="var(--mk-rule-soft)" />
        <Tooltip
          cursor={{ stroke: "var(--mk-ink-20)", strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (active && payload && payload.length) {
              return (
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg shadow-black/5">
                  <p className="m-0 mb-1 font-semibold text-foreground">{label}</p>
                  <div className="flex flex-col gap-0.5">
                    {payload.map((entry, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="size-2 rounded-full" />
                        <span className="text-muted-foreground">{entry.name}</span>
                        <span className="ms-auto font-medium tabular-nums text-foreground">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          }}
        />
        <Area
          type="monotone"
          dataKey="published"
          name={tStatus("published")}
          stroke={SERIES.published}
          strokeWidth={2}
          fill={SERIES.published}
          fillOpacity={0.08}
          hide={hiddenSeries.includes("published")}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="scheduled"
          name={tStatus("scheduled")}
          stroke={SERIES.scheduled}
          strokeWidth={2}
          fill={SERIES.scheduled}
          fillOpacity={0.08}
          hide={hiddenSeries.includes("scheduled")}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
