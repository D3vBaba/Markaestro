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
import { motion } from "framer-motion";

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

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.4, ease },
  }),
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

  const metricCards = [
    {
      label: "Total Contacts",
      value: loading ? "..." : (m?.totalContacts ?? 0).toLocaleString(),
      icon: Users,
      detail: <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-md mr-2"><ArrowUpRight className="h-3 w-3 mr-0.5" /> {m?.activeContacts ?? 0} active</span>,
    },
    {
      label: "Campaigns",
      value: loading ? "..." : String(m?.totalCampaigns ?? 0),
      icon: Mail,
      detail: (
        <>
          <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-md mr-2">{m?.activeCampaigns ?? 0} active</span>
          <span className="text-muted-foreground">{m?.draftCampaigns ?? 0} draft</span>
        </>
      ),
    },
    {
      label: "Automations",
      value: loading ? "..." : String(m?.totalAutomations ?? 0),
      icon: Workflow,
      detail: <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-md mr-2">{m?.enabledAutomations ?? 0} enabled</span>,
    },
    {
      label: "Scheduled Jobs",
      value: loading ? "..." : String(m?.totalJobs ?? 0),
      icon: Timer,
      detail: <span className="text-emerald-600 flex items-center bg-emerald-50 px-1.5 py-0.5 rounded-md mr-2"><Activity className="h-3 w-3 mr-1" /> {m?.enabledJobs ?? 0} active</span>,
    },
  ];

  return (
    <AppShell>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease }}
        className="flex flex-col md:flex-row md:items-end justify-between space-y-4 md:space-y-0 mb-10 pb-6 border-b border-border/60"
      >
        <div>
          <h2 className="text-3xl font-normal tracking-tight text-foreground font-[family-name:var(--font-display)]">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1.5">Welcome back to Markaestro.</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="outline" className="bg-background">Export</Button>
          <Link href="/campaigns"><Button>New Campaign</Button></Link>
        </div>
      </motion.div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {metricCards.map((card, i) => (
          <motion.div key={card.label} custom={i} initial="hidden" animate="visible" variants={fadeUp}>
            <Card className="border hover:border-border transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.04)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">{card.label}</CardTitle>
                <card.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight">{card.value}</div>
                <p className="text-xs text-muted-foreground flex items-center mt-2 font-medium">{card.detail}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-7 mt-6">
        <motion.div
          className="col-span-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4, ease }}
        >
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Overview</CardTitle>
              <CardDescription>Email engagement statistics for the last 7 days.</CardDescription>
            </CardHeader>
            <CardContent className="pl-0">
              <DashboardOverviewChart />
            </CardContent>
          </Card>
        </motion.div>
        <motion.div
          className="col-span-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4, ease }}
        >
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
              <CardDescription>Latest job executions and campaign events.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-5">
                {activity.length > 0 ? (
                  activity.slice(0, 5).map((item) => (
                    <div key={item.id} className="flex items-start justify-between group">
                      <div className="flex gap-3">
                        <div className="mt-1.5 h-2 w-2 rounded-full bg-border group-hover:bg-primary transition-colors shrink-0" />
                        <div className="grid gap-1">
                          <p className="text-sm font-medium leading-none text-foreground">
                            {item.message}
                          </p>
                          <p className="text-xs text-muted-foreground">Job: {item.jobId}</p>
                        </div>
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
                  <div className="py-8 text-center">
                    <div className="h-8 w-8 rounded-lg bg-muted mx-auto mb-3 flex items-center justify-center">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {loading ? "Loading..." : "No recent activity. Run a job to see results here."}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </AppShell>
  );
}
