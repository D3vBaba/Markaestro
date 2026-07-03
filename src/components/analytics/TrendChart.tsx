"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const TOOLTIP_STYLE = {
  background: "var(--mk-paper)",
  border: "1px solid var(--mk-rule)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
  color: "var(--mk-ink)",
  fontSize: 12,
  padding: "6px 10px",
} as const;

function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
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
  color = "var(--mk-ink)",
}: {
  data: Array<Record<string, number | string>>;
  dataKey: string;
  name: string;
  height?: number;
  color?: string;
}) {
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ height, color: "var(--mk-ink-60)" }}
      >
        No data for this period yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="date"
          stroke="var(--mk-ink-40)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          dy={8}
          minTickGap={24}
          tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
          tickFormatter={(v) => shortDate(String(v)).toUpperCase()}
        />
        <YAxis
          stroke="var(--mk-ink-40)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={40}
          tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
        />
        <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--mk-rule-soft)" />
        <Tooltip
          cursor={{ stroke: "var(--mk-rule)", strokeWidth: 1 }}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "var(--mk-ink-60)", fontSize: 11, marginBottom: 4 }}
          itemStyle={{ color: "var(--mk-ink)" }}
          labelFormatter={(v) => shortDate(String(v))}
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
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Follower total over time — domain padded so slow growth stays readable. */
export function FollowerTrendChart({
  data,
  height = 200,
}: {
  data: Array<{ date: string; total: number }>;
  height?: number;
}) {
  if (!data || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-center text-sm px-6"
        style={{ height, color: "var(--mk-ink-60)" }}
      >
        Follower history builds from daily snapshots — the trend appears after a couple of days of data.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="date"
          stroke="var(--mk-ink-40)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          dy={8}
          minTickGap={24}
          tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
          tickFormatter={(v) => shortDate(String(v)).toUpperCase()}
        />
        <YAxis
          stroke="var(--mk-ink-40)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={46}
          domain={["dataMin", "dataMax"]}
          tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
        />
        <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--mk-rule-soft)" />
        <Tooltip
          cursor={{ stroke: "var(--mk-rule)", strokeWidth: 1 }}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "var(--mk-ink-60)", fontSize: 11, marginBottom: 4 }}
          itemStyle={{ color: "var(--mk-ink)" }}
          labelFormatter={(v) => shortDate(String(v))}
        />
        <Area
          type="monotone"
          dataKey="total"
          name="Followers"
          stroke="var(--mk-accent)"
          fill="var(--mk-accent)"
          fillOpacity={0.1}
          strokeWidth={1.6}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
