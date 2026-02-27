"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const data = [
    { name: "Mon", sent: 4000, opened: 2400 },
    { name: "Tue", sent: 3000, opened: 1398 },
    { name: "Wed", sent: 2000, opened: 9800 },
    { name: "Thu", sent: 2780, opened: 3908 },
    { name: "Fri", sent: 1890, opened: 4800 },
    { name: "Sat", sent: 2390, opened: 3800 },
    { name: "Sun", sent: 3490, opened: 4300 },
];

export function DashboardOverviewChart() {
    return (
        <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#000000" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#000000" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorOpened" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#666666" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#666666" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <XAxis
                    dataKey="name"
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
                    tickFormatter={(value) => `${value}`}
                    dx={-10}
                />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" opacity={0.6} />
                <Tooltip
                    contentStyle={{
                        backgroundColor: "#ffffff",
                        borderColor: "#e4e4e7",
                        borderRadius: "var(--radius)",
                        boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                        color: "#18181b"
                    }}
                    itemStyle={{ color: "#18181b" }}
                />
                <Area
                    type="monotone"
                    dataKey="sent"
                    stroke="#18181b"
                    fillOpacity={1}
                    fill="url(#colorSent)"
                    strokeWidth={2}
                />
                <Area
                    type="monotone"
                    dataKey="opened"
                    stroke="#71717a"
                    fillOpacity={1}
                    fill="url(#colorOpened)"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
