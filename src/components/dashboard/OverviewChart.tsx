"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { isRtlLocale } from "@/i18n/routing";

type DailyPost = {
  label: string;
  published: number;
  scheduled: number;
};

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
  const pubGradId = useId();
  const schedGradId = useId();

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-slate-400 font-medium"
        style={{ height }}
      >
        {t("noActivity")}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 10, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={pubGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
          </linearGradient>
          <linearGradient id={schedGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          reversed={isRtl}
          stroke="#94a3b8"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          dy={8}
          tick={{ fill: "#94a3b8", fontWeight: 500 }}
          tickFormatter={(v) => String(v).toUpperCase()}
        />
        <YAxis
          stroke="#94a3b8"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={36}
          orientation={isRtl ? "right" : "left"}
          tick={{ fill: "#94a3b8", fontWeight: 500 }}
        />
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke="rgba(226, 232, 240, 0.6)"
          className="dark:stroke-slate-800/60"
        />
        <Tooltip
          cursor={{ stroke: "#2563eb", strokeWidth: 1.5, strokeDasharray: "4 4" }}
          content={({ active, payload, label }) => {
            if (active && payload && payload.length) {
              return (
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-lg text-xs">
                  <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1.5">{label}</p>
                  <div className="flex flex-col gap-1">
                    {payload.map((entry, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: entry.color }}
                        />
                        <span className="text-slate-500 dark:text-slate-400 capitalize">{entry.name}:</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{entry.value}</span>
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
          stroke="#10b981"
          strokeWidth={2}
          fill={`url(#${pubGradId})`}
          hide={hiddenSeries.includes("published")}
        />
        <Area
          type="monotone"
          dataKey="scheduled"
          name={tStatus("scheduled")}
          stroke="#2563eb"
          strokeWidth={2}
          fill={`url(#${schedGradId})`}
          hide={hiddenSeries.includes("scheduled")}
        />

      </AreaChart>
    </ResponsiveContainer>
  );
}

