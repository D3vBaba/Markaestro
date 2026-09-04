"use client";

import { useTranslations } from "next-intl";
import { Area, AreaChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { isRtlLocale } from "@/i18n/routing";

const TOOLTIP_STYLE = {
  background: "var(--mk-paper)",
  border: "1px solid var(--mk-rule)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
  color: "var(--mk-accent)",
  fontSize: 12,
  padding: "6px 10px",
} as const;

function shortDate(date: string, locale?: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Single-series daily trend (one metric at a time — the page's metric tabs
 * switch the series so wildly different scales never share an axis).
 */
export function TrendChart({
  data,
  dataKey,
  name,
  height = 220,
  color = "var(--mk-accent)",
  locale,
  compare,
  compareName,
}: {
  data: Array<Record<string, number | string>>;
  dataKey: string;
  name: string;
  height?: number;
  color?: string;
  locale?: string;
  /** Previous-period values aligned by index; drawn as a dashed line when given. */
  compare?: number[];
  compareName?: string;
}) {
  const t = useTranslations("analytics.trendChart");
  const merged = compare && compare.length === data.length
    ? data.map((point, index) => ({ ...point, __compare: compare[index] ?? 0 }))
    : data;
  // Recharts has no built-in RTL support — reverse the x-axis explicitly for
  // RTL locales so the timeline progresses right-to-left, matching reading
  // direction.
  const isRtl = isRtlLocale(locale ?? "en");

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ height, color: "var(--mk-ink-60)" }}
      >
        {t("noData")}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={merged} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="date"
          reversed={isRtl}
          stroke="var(--mk-ink-40)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          dy={8}
          minTickGap={24}
          tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
          tickFormatter={(v) => shortDate(String(v), locale)}
        />
        <YAxis
          stroke="var(--mk-ink-40)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={40}
          orientation={isRtl ? "right" : "left"}
          tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
        />
        <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--mk-rule-soft)" />
        <Tooltip
          cursor={{ stroke: "var(--mk-rule)", strokeWidth: 1 }}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "var(--mk-ink-60)", fontSize: 11, marginBottom: 4 }}
          itemStyle={{ color: "var(--mk-ink)" }}
          labelFormatter={(v) => shortDate(String(v), locale)}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={color}
          fill={color}
          fillOpacity={0.12}
          strokeWidth={1.6}
        />
        {merged !== data && (
          <Line
            type="monotone"
            dataKey="__compare"
            name={compareName ?? t("previousPeriod")}
            stroke="var(--mk-ink-40)"
            strokeDasharray="4 4"
            strokeWidth={1.2}
            dot={false}
            activeDot={false}
          />
        )}
        {merged !== data && <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Follower total over time — domain padded so slow growth stays readable. */
export function FollowerTrendChart({
  data,
  height = 200,
  locale,
}: {
  data: Array<{ date: string; total: number }>;
  height?: number;
  locale?: string;
}) {
  const t = useTranslations("analytics.trendChart");
  const isRtl = isRtlLocale(locale ?? "en");

  if (!data || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-center text-sm px-6"
        style={{ height, color: "var(--mk-ink-60)" }}
      >
        {t("followerHistoryBuilds")}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="date"
          reversed={isRtl}
          stroke="var(--mk-ink-40)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          dy={8}
          minTickGap={24}
          tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
          tickFormatter={(v) => shortDate(String(v), locale)}
        />
        <YAxis
          stroke="var(--mk-ink-40)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={46}
          domain={["dataMin", "dataMax"]}
          orientation={isRtl ? "right" : "left"}
          tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
        />
        <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--mk-rule-soft)" />
        <Tooltip
          cursor={{ stroke: "var(--mk-rule)", strokeWidth: 1 }}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "var(--mk-ink-60)", fontSize: 11, marginBottom: 4 }}
          itemStyle={{ color: "var(--mk-ink)" }}
          labelFormatter={(v) => shortDate(String(v), locale)}
        />
        <Area
          type="monotone"
          dataKey="total"
          name={t("followersSeriesName")}
          stroke="var(--mk-accent)"
          fill="var(--mk-accent)"
          fillOpacity={0.1}
          strokeWidth={1.6}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
