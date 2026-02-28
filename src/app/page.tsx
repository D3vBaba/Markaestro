"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail, Workflow, Timer, ArrowUpRight, Activity } from "lucide-react";
import { DashboardOverviewChart } from "@/components/dashboard/OverviewChart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api-client";
import Link from "next/link";

type DashboardMetrics = {
  totalContacts: number;
  activeContacts: number;
  totalCampaigns: number;
  activeCampaigns: number;
  draftCampaigns: number;
  totalAutomations: number;
  enabledAutomations: number;
  totalJobs: number;
  enabledJobs: number;
};

type ActivityItem = {
  id: string;
  jobId: string;
  status: string;
  message: string;
  startedAt: string;
};

export default function Home() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{
          metrics: DashboardMetrics;
          recentActivity: ActivityItem[];
        }>("/api/dashboard");
        if (res.ok) {
          setMetrics(res.data.metrics);
          setActivity(res.data.recentActivity || []);
        }
      } catch {
        // silently fail — dashboard will show zeros
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const m = metrics;

  return (
    <AppShell>
      <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0 mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h2>
          <p className="text-muted-foreground mt-1">Welcome back to Markaestro.</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="outline" className="bg-background">Export</Button>
          <Link href="/campaigns"><Button>New Campaign</Button></Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Contacts</CardTitle>
            <Users className="h-4 w-4 text-foreground opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">
              {loading ? "..." : (m?.totalContacts ?? 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground flex items-center mt-2 font-medium">
              <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-sm mr-2">
                <ArrowUpRight className="h-3 w-3 mr-0.5" /> {m?.activeContacts ?? 0} active
              </span>
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Campaigns</CardTitle>
            <Mail className="h-4 w-4 text-foreground opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">
              {loading ? "..." : (m?.totalCampaigns ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground flex items-center mt-2 font-medium">
              <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-sm mr-2">
                {m?.activeCampaigns ?? 0} active
              </span>
              <span className="text-muted-foreground">{m?.draftCampaigns ?? 0} draft</span>
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Automations</CardTitle>
            <Workflow className="h-4 w-4 text-foreground opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">
              {loading ? "..." : (m?.totalAutomations ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground flex items-center mt-2 font-medium">
              <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-sm mr-2">
                {m?.enabledAutomations ?? 0} enabled
              </span>
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Scheduled Jobs</CardTitle>
            <Timer className="h-4 w-4 text-foreground opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">
              {loading ? "..." : (m?.totalJobs ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground flex items-center mt-2 font-medium">
              <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-sm mr-2">
                <Activity className="h-3 w-3 mr-1" /> {m?.enabledJobs ?? 0} active
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7 mt-6">
        <Card className="col-span-4 shadow-sm">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>Email engagement statistics for the last 7 days.</CardDescription>
          </CardHeader>
          <CardContent className="pl-0">
            <DashboardOverviewChart />
          </CardContent>
        </Card>
        <Card className="col-span-3 shadow-sm">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest job executions and campaign events.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {activity.length > 0 ? (
                activity.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-start justify-between group">
                    <div className="grid gap-1">
                      <p className="text-sm font-medium leading-none text-foreground">
                        {item.message}
                      </p>
                      <p className="text-xs text-muted-foreground">Job: {item.jobId}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] font-medium h-5 border-0 ${
                          item.status === "success"
                            ? "bg-emerald-50 text-emerald-700"
                            : item.status === "failed"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {item.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {item.startedAt ? new Date(item.startedAt).toLocaleString() : ""}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {loading ? "Loading..." : "No recent activity. Run a job to see results here."}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
