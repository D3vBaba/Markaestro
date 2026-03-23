"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="p-4 sm:p-5 rounded-lg border border-border/40 bg-card">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-light tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
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
        <div className="h-5 w-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">No performance data yet</p>
        <p className="text-xs text-muted-foreground/60 mt-2">Create and publish posts to see analytics here.</p>
      </div>
    );
  }

  const scoreColor = stats.publishSuccessRate >= 90 ? "text-emerald-600" : stats.publishSuccessRate >= 70 ? "text-amber-600" : "text-rose-600";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Post Performance</h3>
        <Button variant="outline" size="sm" onClick={fetchStats} className="text-xs">
          Refresh
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Posts" value={stats.total} />
        <StatCard label="Published" value={stats.totalPublished} sub={`${stats.last7DaysPublished} this week`} />
        <StatCard label="Scheduled" value={stats.totalScheduled} />
        <StatCard label="Drafts" value={stats.totalDraft} />
      </div>

      {/* Success rate + velocity */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Publish Success Rate</CardTitle>
            <CardDescription className="text-xs">% of attempted publishes that succeeded</CardDescription>
          </CardHeader>
          <CardContent>
            <span className={`text-4xl font-light tabular-nums ${scoreColor}`}>{stats.publishSuccessRate}%</span>
            {stats.totalFailed > 0 && (
              <p className="text-xs text-destructive mt-3">
                {stats.totalFailed} post{stats.totalFailed !== 1 ? "s" : ""} failed -- check Drafts to retry
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Publishing Velocity</CardTitle>
            <CardDescription className="text-xs">Posts published over time</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Last 7 days</span>
              <span className="font-medium tabular-nums">{stats.last7DaysPublished}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Last 30 days</span>
              <span className="font-medium tabular-nums">{stats.last30DaysPublished}</span>
            </div>
            {stats.topChannel && (
              <div className="flex items-center justify-between text-sm pt-2 border-t border-border/30">
                <span className="text-muted-foreground">Top channel</span>
                <span className="text-xs font-medium">{channelLabels[stats.topChannel.channel] || stats.topChannel.channel}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* By channel breakdown */}
      {Object.keys(stats.byChannel).length > 0 && (
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">By Channel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(stats.byChannel)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([channel, cs]) => {
                  const pct = cs.total > 0 ? Math.round((cs.published / cs.total) * 100) : 0;
                  return (
                    <div key={channel} className="space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:gap-4">
                      <span className="text-xs font-medium sm:w-24 sm:shrink-0 block">
                        {channelLabels[channel] || channel}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-foreground transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground sm:shrink-0 tabular-nums">
                        <span><span className="font-medium text-foreground">{cs.published}</span> published</span>
                        {cs.scheduled > 0 && <span>{cs.scheduled} sched.</span>}
                        {cs.draft > 0 && <span>{cs.draft} draft</span>}
                        {cs.failed > 0 && <span className="text-destructive">{cs.failed} failed</span>}
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
