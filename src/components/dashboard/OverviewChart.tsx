"use client";

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
    // Recharts has no built-in RTL support — the x-axis always progresses
    // left-to-right internally, so for RTL locales we explicitly reverse it
    // to match the reading direction (time flows right-to-left).
    const isRtl = isRtlLocale(useLocale());

    if (!data || data.length === 0) {
        return (
            <div
                className="flex items-center justify-center text-sm"
                style={{ height, color: "var(--mk-ink-60)" }}
            >
                {t("noActivity")}
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                    dataKey="label"
                    reversed={isRtl}
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
                    orientation={isRtl ? "right" : "left"}
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
                    name={tStatus("published")}
                    stroke="var(--mk-ink)"
                    fill="var(--mk-ink)"
                    fillOpacity={0.85}
                    strokeWidth={0}
                    stackId="1"
                    hide={hiddenSeries.includes("published")}
                />
                <Area
                    type="monotone"
                    dataKey="scheduled"
                    name={tStatus("scheduled")}
                    stroke="var(--mk-accent)"
                    fill="var(--mk-accent)"
                    fillOpacity={0.85}
                    strokeWidth={0}
                    stackId="1"
                    hide={hiddenSeries.includes("scheduled")}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
