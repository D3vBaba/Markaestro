"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpRight, Send, Megaphone, Package } from "lucide-react";
import { DashboardOverviewChart } from "@/components/dashboard/OverviewChart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api-client";
import Link from "next/link";
import { motion } from "framer-motion";

type DashboardMetrics = {
  totalProducts: number;
  activeProducts: number;
  totalCampaigns: number;
  activeCampaigns: number;
  draftCampaigns: number;
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  totalAdCampaigns: number;
  activeAds: number;
  totalAdSpend: number;
  totalAdImpressions: number;
  totalAdClicks: number;
  postsByChannel: Record<string, number>;
};

type DailyPost = {
  date: string;
  label: string;
  published: number;
  scheduled: number;
};

type RecentPost = {
  id: string;
  channel: string;
  status: string;
  content: string;
  date: string;
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

const channelLabels: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

export default function Home() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [dailyPosts, setDailyPosts] = useState<DailyPost[]>([]);
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{
          metrics: DashboardMetrics;
          dailyPosts: DailyPost[];
          recentPosts: RecentPost[];
        }>("/api/dashboard");
        if (res.ok) {
          setMetrics(res.data.metrics);
          setDailyPosts(res.data.dailyPosts || []);
          setRecentPosts(res.data.recentPosts || []);
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
      label: "Products",
      value: loading ? "..." : String(m?.totalProducts ?? 0),
      detail: (
        <span className="text-emerald-600 flex items-center bg-emerald-50 px-2 py-0.5 rounded-lg">
          <ArrowUpRight className="h-3 w-3 mr-0.5" /> {m?.activeProducts ?? 0} active
        </span>
      ),
      icon: Package,
    },
    {
      label: "Campaigns",
      value: loading ? "..." : String(m?.totalCampaigns ?? 0),
      detail: (
        <>
          <span className="text-emerald-600 flex items-center bg-emerald-50 px-2 py-0.5 rounded-lg mr-2">{m?.activeCampaigns ?? 0} active</span>
          <span className="text-muted-foreground">{m?.draftCampaigns ?? 0} draft</span>
        </>
      ),
      icon: Megaphone,
    },
    {
      label: "Posts",
      value: loading ? "..." : String(m?.totalPosts ?? 0),
      detail: (
        <>
          <span className="text-emerald-600 flex items-center bg-emerald-50 px-2 py-0.5 rounded-lg mr-2">{m?.publishedPosts ?? 0} published</span>
          <span className="text-muted-foreground">{m?.scheduledPosts ?? 0} scheduled</span>
        </>
      ),
      icon: Send,
    },
    {
      label: "Ad Campaigns",
      value: loading ? "..." : String(m?.totalAdCampaigns ?? 0),
      detail: (
        <>
          <span className="text-emerald-600 flex items-center bg-emerald-50 px-2 py-0.5 rounded-lg mr-2">{m?.activeAds ?? 0} active</span>
          {(m?.totalAdSpend ?? 0) > 0 && (
            <span className="text-muted-foreground">${((m?.totalAdSpend ?? 0) / 100).toLocaleString()} spent</span>
          )}
        </>
      ),
      icon: Megaphone,
    },
  ];

  return (
    <AppShell>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease }}
        className="flex flex-col md:flex-row md:items-end justify-between space-y-4 md:space-y-0 mb-10 pb-8 border-b border-border/40"
      >
        <div>
          <h2 className="text-3xl font-normal tracking-tight font-[family-name:var(--font-display)] text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-2">Welcome back to Markaestro.</p>
        </div>
        <div className="flex items-center space-x-3">
          <Link href="/content"><Button variant="outline" className="bg-background rounded-xl">New Post</Button></Link>
          <Link href="/campaigns"><Button className="rounded-xl">New Campaign</Button></Link>
        </div>
      </motion.div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {metricCards.map((card, i) => (
          <motion.div key={card.label} custom={i} initial="hidden" animate="visible" variants={fadeUp}>
            <Card className="card-premium overflow-hidden border-border/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">{card.label}</CardTitle>
                <card.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight">{card.value}</div>
                <p className="text-xs text-muted-foreground flex items-center mt-3 font-medium">{card.detail}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-7 mt-6">
        <motion.div
          className="md:col-span-2 lg:col-span-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4, ease }}
        >
          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Publishing Activity</CardTitle>
              <CardDescription>Posts published and scheduled over the last 7 days.</CardDescription>
            </CardHeader>
            <CardContent className="pl-0">
              <DashboardOverviewChart data={dailyPosts} />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          className="md:col-span-2 lg:col-span-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4, ease }}
        >
          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Recent Posts</CardTitle>
              <CardDescription>Latest published and scheduled content.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-5">
                {recentPosts.length > 0 ? (
                  recentPosts.map((post) => (
                    <div key={post.id} className="flex items-start justify-between group">
                      <div className="flex gap-3">
                        <div className="mt-1.5 h-2 w-2 rounded-full bg-border group-hover:bg-primary transition-colors shrink-0" />
                        <div className="grid gap-1">
                          <p className="text-sm font-medium leading-none text-foreground line-clamp-1">
                            {post.content || "Untitled post"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {channelLabels[post.channel] || post.channel}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-medium h-5 border-0 ${
                            post.status === "published"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-blue-50 text-blue-700"
                          }`}
                        >
                          {post.status}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {post.date ? new Date(post.date).toLocaleDateString() : ""}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center">
                    <div className="h-10 w-10 rounded-xl bg-primary mx-auto mb-3 flex items-center justify-center">
                      <Send className="h-4 w-4 text-white" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {loading ? "Loading..." : "No posts yet. Create your first post to see activity here."}
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
