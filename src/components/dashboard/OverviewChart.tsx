"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type DailyPost = {
  label: string;
  published: number;
  scheduled: number;
};

export function DashboardOverviewChart({ data }: { data: DailyPost[] }) {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-[350px] text-sm text-muted-foreground">
                No post activity yet.
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorPublished" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorScheduled" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <XAxis
                    dataKey="label"
                    stroke="#a1a1aa"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    dy={10}
                />
                <YAxis
                    stroke="#a1a1aa"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    dx={-10}
                />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" opacity={0.4} />
                <Tooltip
                    contentStyle={{
                        backgroundColor: "#ffffff",
                        borderColor: "#e4e4e7",
                        borderRadius: "12px",
                        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.06)",
                        color: "#18181b",
                        fontSize: "13px",
                    }}
                    itemStyle={{ color: "#18181b" }}
                />
                <Area
                    type="monotone"
                    dataKey="published"
                    name="Published"
                    stroke="#10b981"
                    fillOpacity={1}
                    fill="url(#colorPublished)"
                    strokeWidth={2}
                />
                <Area
                    type="monotone"
                    dataKey="scheduled"
                    name="Scheduled"
                    stroke="#6366f1"
                    fillOpacity={1}
                    fill="url(#colorScheduled)"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
