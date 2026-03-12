"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Send, CheckCircle2, Clock, FileText, AlertTriangle,
  TrendingUp, RefreshCw, BarChart3, Loader2,
} from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { toast } from "sonner";

type ChannelStats = {
  total: number;
  published: number;
  scheduled: number;
  draft: number;
  failed: number;
};

type PostStats = {
  total: number;
  totalPublished: number;
  totalScheduled: number;
  totalDraft: number;
  totalFailed: number;
  publishSuccessRate: number;
  last7DaysPublished: number;
  last30DaysPublished: number;
  byChannel: Record<string, ChannelStats>;
  topChannel: { channel: string; published: number } | null;
};

const channelLabels: Record<string, string> = {
  x: "X (Twitter)",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const channelColors: Record<string, string> = {
  x: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  facebook: "bg-blue-50 text-blue-700",
  instagram: "bg-sky-50 text-sky-700",
  tiktok: "bg-pink-50 text-pink-700",
};

function StatCard({ icon: Icon, label, value, sub }: { icon: typeof Send; label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/30">
      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-4.5 w-4.5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold tabular-nums">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export default function PerformanceTab({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<PostStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ ok: boolean; stats: PostStats }>("/api/posts/analytics");
      if (res.ok && res.data.stats) setStats(res.data.stats);
      else toast.error("Failed to load post analytics");
    } catch {
      toast.error("Failed to load post analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm font-medium">No performance data yet</p>
        <p className="text-xs mt-1">Create and publish posts to see analytics here.</p>
      </div>
    );
  }

  const scoreColor = stats.publishSuccessRate >= 90 ? "text-emerald-600" : stats.publishSuccessRate >= 70 ? "text-amber-600" : "text-rose-600";
  const scoreBg = stats.publishSuccessRate >= 90 ? "bg-emerald-50" : stats.publishSuccessRate >= 70 ? "bg-amber-50" : "bg-rose-50";

  return (
    <div className="space-y-6">
      {/* Header strip */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Post Performance</h3>
        <Button variant="outline" size="sm" onClick={fetchStats}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Send} label="Total Posts" value={stats.total} />
        <StatCard icon={CheckCircle2} label="Published" value={stats.totalPublished} sub={`${stats.last7DaysPublished} this week`} />
        <StatCard icon={Clock} label="Scheduled" value={stats.totalScheduled} />
        <StatCard icon={FileText} label="Drafts" value={stats.totalDraft} />
      </div>

      {/* Success rate + velocity */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-border/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />Publish Success Rate
            </CardTitle>
            <CardDescription>% of attempted publishes that succeeded</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`inline-flex items-baseline gap-1 px-3 py-2 rounded-xl ${scoreBg}`}>
              <span className={`text-3xl font-bold tabular-nums ${scoreColor}`}>{stats.publishSuccessRate}%</span>
              <span className={`text-sm ${scoreColor}`}>success</span>
            </div>
            {stats.totalFailed > 0 && (
              <div className="flex items-center gap-2 mt-3 text-xs text-rose-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{stats.totalFailed} post{stats.totalFailed !== 1 ? "s" : ""} failed — check Drafts to retry</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />Publishing Velocity
            </CardTitle>
            <CardDescription>Posts published over time</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Last 7 days</span>
              <span className="font-semibold tabular-nums">{stats.last7DaysPublished}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Last 30 days</span>
              <span className="font-semibold tabular-nums">{stats.last30DaysPublished}</span>
            </div>
            {stats.topChannel && (
              <div className="flex items-center justify-between text-sm pt-1 border-t border-border/30">
                <span className="text-muted-foreground">Top channel</span>
                <Badge variant="outline" className={`border-0 text-[10px] ${channelColors[stats.topChannel.channel] || ""}`}>
                  {channelLabels[stats.topChannel.channel] || stats.topChannel.channel}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* By channel breakdown */}
      {Object.keys(stats.byChannel).length > 0 && (
        <Card className="border-border/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By Channel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(stats.byChannel)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([channel, cs]) => {
                  const pct = cs.total > 0 ? Math.round((cs.published / cs.total) * 100) : 0;
                  return (
                    <div key={channel} className="flex items-center gap-3">
                      <Badge variant="outline" className={`border-0 text-[10px] w-24 justify-center shrink-0 ${channelColors[channel] || "bg-muted text-muted-foreground"}`}>
                        {channelLabels[channel] || channel}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        {/* Progress bar */}
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
                        <span><span className="font-semibold text-foreground">{cs.published}</span> published</span>
                        {cs.scheduled > 0 && <span>{cs.scheduled} sched.</span>}
                        {cs.draft > 0 && <span>{cs.draft} draft</span>}
                        {cs.failed > 0 && <span className="text-rose-600">{cs.failed} failed</span>}
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
