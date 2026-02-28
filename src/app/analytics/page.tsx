"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import MetricCard from "@/components/app/MetricCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api-client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

type AnalyticsData = {
  overview: { totalContacts: number; totalCampaigns: number; totalEvents: number; totalProducts: number };
  lifecycleFunnel: Record<string, number>;
  sourceBreakdown: Record<string, number>;
  dailyActivity: { date: string; events: number }[];
  jobPerformance: { totalRuns: number; successRuns: number; failedRuns: number; successRate: number };
  productStats: { id: string; name: string; contacts: number; campaigns: number }[];
  campaignStats: { name: string; channel: string; status: string; lastSentCount: number }[];
};

const COLORS = ["#18181b", "#71717a", "#a1a1aa", "#d4d4d8", "#e4e4e7"];

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<AnalyticsData>("/api/analytics");
        if (res.ok) setData(res.data);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) {
    return (
      <AppShell>
        <PageHeader title="Analytics" subtitle="Track growth outcomes and channel efficiency." />
        <p className="text-sm text-muted-foreground">Loading analytics...</p>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell>
        <PageHeader title="Analytics" subtitle="Track growth outcomes and channel efficiency." />
        <p className="text-sm text-muted-foreground">Failed to load analytics data.</p>
      </AppShell>
    );
  }

  const funnelData = Object.entries(data.lifecycleFunnel).map(([name, value]) => ({ name, value }));
  const sourceData = Object.entries(data.sourceBreakdown).map(([name, value]) => ({ name, value }));

  return (
    <AppShell>
      <PageHeader title="Analytics" subtitle="Track growth outcomes and channel efficiency." />

      {/* Overview metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Contacts" value={String(data.overview.totalContacts)} />
        <MetricCard label="Total Campaigns" value={String(data.overview.totalCampaigns)} />
        <MetricCard label="Total Events" value={String(data.overview.totalEvents)} />
        <MetricCard label="Products" value={String(data.overview.totalProducts)} />
      </div>

      <div className="grid gap-6 md:grid-cols-2 mt-6">
        {/* Lifecycle Funnel */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Contact Lifecycle Funnel</CardTitle>
            <CardDescription>Distribution across lifecycle stages.</CardDescription>
          </CardHeader>
          <CardContent>
            {funnelData.some((d) => d.value > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={funnelData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" opacity={0.6} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} className="capitalize" />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: "8px", borderColor: "#e4e4e7" }} />
                  <Bar dataKey="value" fill="#18181b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">No contact data yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Source Breakdown */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Contact Sources</CardTitle>
            <CardDescription>Where your contacts come from.</CardDescription>
          </CardHeader>
          <CardContent>
            {sourceData.some((d) => d.value > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={sourceData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`} labelLine={false}>
                    {sourceData.map((_entry, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">No source data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mt-6">
        {/* Daily Activity */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Daily Event Activity</CardTitle>
            <CardDescription>Events tracked over the last 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.dailyActivity} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" opacity={0.6} />
                <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { weekday: 'short' })} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="events" fill="#71717a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Job Performance */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Job Performance</CardTitle>
            <CardDescription>Execution success rate for scheduled jobs.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <p className="text-3xl font-bold">{data.jobPerformance.successRate}%</p>
                <p className="text-xs text-muted-foreground mt-1">Success Rate</p>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <p className="text-3xl font-bold">{data.jobPerformance.totalRuns}</p>
                <p className="text-xs text-muted-foreground mt-1">Total Runs</p>
              </div>
              <div className="text-center p-4 bg-emerald-50 rounded-lg">
                <p className="text-2xl font-bold text-emerald-700">{data.jobPerformance.successRuns}</p>
                <p className="text-xs text-emerald-600 mt-1">Successful</p>
              </div>
              <div className="text-center p-4 bg-rose-50 rounded-lg">
                <p className="text-2xl font-bold text-rose-700">{data.jobPerformance.failedRuns}</p>
                <p className="text-xs text-rose-600 mt-1">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Product Stats */}
      {data.productStats.length > 0 && (
        <Card className="shadow-sm mt-6">
          <CardHeader>
            <CardTitle>Product Performance</CardTitle>
            <CardDescription>Contacts and campaigns per product.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {data.productStats.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                  <span className="font-medium">{p.name}</span>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{p.contacts} contacts</span>
                    <span>{p.campaigns} campaigns</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
