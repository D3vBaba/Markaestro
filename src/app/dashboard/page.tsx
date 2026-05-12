"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { DashboardOverviewChart } from "@/components/dashboard/OverviewChart";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";
import { Status } from "@/components/mk/Status";
import { Channel } from "@/components/mk/Channel";
import { channelLabel } from "@/components/mk/channels";
import { fmtCount } from "@/components/mk/format";
import { Plus } from "lucide-react";

type DashboardMetrics = {
  totalProducts: number;
  activeProducts: number;
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
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

type Kpi = {
  key: string;
  label: string;
  value: string;
  sub?: string;
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
  const publishedTotal = dailyPosts.reduce((a, d) => a + (d.published || 0), 0);

  const kpis: Kpi[] = [
    {
      key: "products",
      label: "Products",
      value: loading ? "—" : fmtCount(m?.totalProducts ?? 0),
      sub: `${m?.activeProducts ?? 0} active`,
    },
    {
      key: "posts",
      label: "Posts",
      value: loading ? "—" : fmtCount(m?.totalPosts ?? 0),
      sub: `${m?.publishedPosts ?? 0} published · ${m?.scheduledPosts ?? 0} scheduled`,
    },
    {
      key: "week",
      label: "Published · 7d",
      value: loading ? "—" : fmtCount(publishedTotal),
      sub: `across ${dailyPosts.length} days`,
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        subtitle="Your marketing engine at a glance."
        action={
          <Link href="/content">
            <Button className="rounded-lg h-9 text-[13px] gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New post
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left column */}
        <div className="flex flex-col gap-4 sm:gap-5 min-w-0">
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
            {kpis.map((k) => (
              <div
                key={k.key}
                className="rounded-xl p-3 sm:p-4"
                style={{
                  background: "var(--mk-paper)",
                  border: "1px solid var(--mk-rule)",
                }}
              >
                <div className="mk-eyebrow">{k.label}</div>
                <div
                  className="mt-1.5 sm:mt-2 text-[22px] sm:text-[26px] font-semibold mk-figure"
                  style={{ color: "var(--mk-ink)" }}
                >
                  {k.value}
                </div>
                {k.sub && (
                  <div
                    className="mt-1 text-[10.5px] sm:text-[11px] font-mono truncate"
                    style={{ color: "var(--mk-ink-40)", letterSpacing: "0.04em" }}
                  >
                    {k.sub}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Chart card */}
          <div
            className="rounded-xl p-4 sm:p-5"
            style={{
              background: "var(--mk-paper)",
              border: "1px solid var(--mk-rule)",
            }}
          >
            <div className="flex items-start justify-between mb-3.5 gap-3 flex-wrap">
              <div>
                <div className="mk-eyebrow">Publishing activity · 7d</div>
                <div
                  className="mt-1 text-[18px] font-semibold"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.02em" }}
                >
                  {fmtCount(publishedTotal)} published this week
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex items-center gap-1.5 text-[11px]"
                  style={{ color: "var(--mk-ink-60)" }}
                >
                  <span
                    className="inline-block rounded-[2px]"
                    style={{ width: 10, height: 10, background: "var(--mk-ink)" }}
                  />
                  Published
                </span>
                <span
                  className="inline-flex items-center gap-1.5 text-[11px]"
                  style={{ color: "var(--mk-ink-60)" }}
                >
                  <span
                    className="inline-block rounded-[2px]"
                    style={{ width: 10, height: 10, background: "var(--mk-accent)" }}
                  />
                  Scheduled
                </span>
              </div>
            </div>
            <DashboardOverviewChart data={dailyPosts} height={240} />
          </div>

          {/* Posts by channel */}
          {m?.postsByChannel && Object.keys(m.postsByChannel).length > 0 && (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: "var(--mk-paper)",
                border: "1px solid var(--mk-rule)",
              }}
            >
              <div
                className="px-4 sm:px-5 py-3 sm:py-3.5 border-b"
                style={{ borderColor: "var(--mk-rule)" }}
              >
                <div className="mk-eyebrow">Distribution</div>
                <div
                  className="mt-1 text-[15px] sm:text-[16px] font-semibold"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.02em" }}
                >
                  Posts by channel
                </div>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--mk-rule-soft)" }}>
                {Object.entries(m.postsByChannel)
                  .sort((a, b) => b[1] - a[1])
                  .map(([ch, count], i, arr) => {
                    const total = arr.reduce((a, [, v]) => a + v, 0) || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={ch} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                        <Channel channel={ch} size={22} />
                        <span
                          className="flex-1 text-[13px]"
                          style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                        >
                          {channelLabel(ch)}
                        </span>
                        <span
                          className="font-mono text-[12px]"
                          style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.01em" }}
                        >
                          {pct}%
                        </span>
                        <span
                          className="font-mono text-[13px] mk-figure text-right w-10"
                          style={{ color: "var(--mk-ink)" }}
                        >
                          {fmtCount(count)}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4 min-w-0">
          <div
            className="rounded-xl p-4"
            style={{
              background: "var(--mk-paper)",
              border: "1px solid var(--mk-rule)",
            }}
          >
            <div className="flex items-end justify-between mb-3">
              <div>
                <div className="mk-eyebrow">Up next</div>
                <h3
                  className="mt-1 text-[16px] font-semibold m-0"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.02em" }}
                >
                  Recent posts
                </h3>
              </div>
              <Link
                href="/calendar"
                className="text-[12px]"
                style={{ color: "var(--mk-ink-60)" }}
              >
                Calendar →
              </Link>
            </div>

            {recentPosts.length > 0 ? (
              <div className="flex flex-col">
                {recentPosts.map((post, i) => (
                  <Link
                    key={post.id}
                    href={`/content/${post.id}`}
                    className="flex items-start gap-2.5 py-2.5"
                    style={{
                      borderTop: i === 0 ? "none" : "1px solid var(--mk-rule-soft)",
                    }}
                  >
                    <div className="pt-0.5">
                      <Channel channel={post.channel} size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[12.5px] font-medium line-clamp-2"
                        style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                      >
                        {post.content || "Untitled post"}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Status value={post.status} />
                        {post.date && (
                          <span
                            className="font-mono text-[9.5px]"
                            style={{ color: "var(--mk-ink-40)", letterSpacing: "0.08em" }}
                          >
                            {new Date(post.date).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div
                className="py-8 text-center text-[13px]"
                style={{ color: "var(--mk-ink-60)" }}
              >
                {loading
                  ? "Loading…"
                  : "No posts yet. Create your first to see activity here."}
              </div>
            )}

            <Link href="/content" className="block mt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full rounded-lg text-[12px] gap-1.5"
              >
                <Plus className="h-3 w-3" />
                New post
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
