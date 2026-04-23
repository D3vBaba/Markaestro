"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type DailyPost = {
    label: string;
    published: number;
    scheduled: number;
};

export function DashboardOverviewChart({ data, height = 240 }: { data: DailyPost[]; height?: number }) {
    if (!data || data.length === 0) {
        return (
            <div
                className="flex items-center justify-center text-sm"
                style={{ height, color: "var(--mk-ink-60)" }}
            >
                No post activity yet.
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                    dataKey="label"
                    stroke="var(--mk-ink-40)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    dy={8}
                    tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}
                    tickFormatter={(v) => String(v).toUpperCase()}
                />
                <YAxis
                    stroke="var(--mk-ink-40)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={32}
                    tick={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
                />
                <CartesianGrid
                    strokeDasharray="2 4"
                    vertical={false}
                    stroke="var(--mk-rule-soft)"
                />
                <Tooltip
                    cursor={{ stroke: "var(--mk-rule)", strokeWidth: 1 }}
                    contentStyle={{
                        background: "var(--mk-paper)",
                        border: "1px solid var(--mk-rule)",
                        borderRadius: 8,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
                        color: "var(--mk-ink)",
                        fontSize: 12,
                        padding: "6px 10px",
                    }}
                    labelStyle={{ color: "var(--mk-ink-60)", fontSize: 11, marginBottom: 4 }}
                    itemStyle={{ color: "var(--mk-ink)" }}
                />
                <Area
                    type="monotone"
                    dataKey="published"
                    name="Published"
                    stroke="var(--mk-ink)"
                    fill="var(--mk-ink)"
                    fillOpacity={0.85}
                    strokeWidth={0}
                    stackId="1"
                />
                <Area
                    type="monotone"
                    dataKey="scheduled"
                    name="Scheduled"
                    stroke="var(--mk-accent)"
                    fill="var(--mk-accent)"
                    fillOpacity={0.85}
                    strokeWidth={0}
                    stackId="1"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
