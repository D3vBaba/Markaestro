"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost } from "@/lib/api-client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { ExternalLink } from "lucide-react";
import { FeatureGate } from "@/components/app/FeatureGate";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { motion } from "framer-motion";
import { pillStyle, type PillTone } from "@/components/mk/pills";
import { channelColor } from "@/components/mk/channels";

// ── Types ────────────────────────────────────────────────────────

type Product = { id: string; name: string };

type FacebookPost = {
  id: string; message?: string; imageUrl?: string; createdTime: string;
  permalink?: string;
  likes: number; comments: number; shares: number;
  views?: number; reach?: number;
};

type InstagramMedia = {
  id: string; caption?: string; mediaType: string; mediaUrl?: string;
  thumbnailUrl?: string; timestamp: string; likes: number; comments: number;
  permalink?: string;
  views?: number; reach?: number; saved?: number; shares?: number;
};

type TikTokVideo = {
  id: string; title?: string; coverUrl?: string; createTime: number;
  shareUrl?: string; views: number; likes: number; comments: number; shares: number;
};

type FacebookInsights = {
  platform: "facebook"; connected: boolean; error?: string;
  pageName?: string; username?: string; avatarUrl?: string; bio?: string;
  profileUrl?: string; isVerified?: boolean;
  followers?: number; rangeDays?: number;
  impressions?: number; engagements?: number; reach?: number;
  // Legacy fields — populated only for the default 7d range.
  impressions7d?: number; engagements7d?: number; reach7d?: number;
  recentPosts?: FacebookPost[];
};

type InstagramInsights = {
  platform: "instagram"; connected: boolean; error?: string;
  displayName?: string; username?: string; avatarUrl?: string; bio?: string;
  profileUrl?: string; website?: string;
  followersCount?: number; follows?: number; mediaCount?: number;
  recentMedia?: InstagramMedia[];
};

type TikTokInsights = {
  platform: "tiktok"; connected: boolean; error?: string;
  displayName?: string; avatarUrl?: string; username?: string;
  bioDescription?: string; isVerified?: boolean; profileDeepLink?: string;
  followers?: number; following?: number; totalLikes?: number;
  videoCount?: number; recentVideos?: TikTokVideo[];
};

type UnifiedInsights = {
  productId: string; productName: string;
  facebook: FacebookInsights; instagram: InstagramInsights;
  tiktok: TikTokInsights; fetchedAt: string;
};

type Tip = {
  title: string; tip: string; priority: "high" | "medium" | "low";
  platform: string;
};

// ── Constants ────────────────────────────────────────────────────

const STORAGE_KEY = "markaestro_default_product";
const ease = [0.25, 0.46, 0.45, 0.94] as const;

const RANGES = ["7d", "30d", "90d"] as const;
type Range = (typeof RANGES)[number];

const priorityTone: Record<string, PillTone> = {
  high: "neg",
  medium: "warn",
  low: "accent",
};

function platformBadgeStyle(platform: string): React.CSSProperties {
  if (platform === "cross-platform") {
    return pillStyle("ink");
  }
  const c = channelColor(platform);
  return {
    background: `color-mix(in oklch, ${c} 12%, var(--mk-paper))`,
    color: `color-mix(in oklch, ${c} 60%, var(--mk-ink))`,
  };
}


// Bar fill colors for the chart — driven by Markaestro channel tokens
const platformBarColors: Record<string, string> = {
  Facebook: "var(--mk-ch-facebook)",
  Instagram: "var(--mk-ch-instagram)",
  TikTok: "var(--mk-ch-tiktok)",
};

// ── Helpers ──────────────────────────────────────────────────────

function engagementRate(engagements: number, reach: number): string {
  if (reach === 0) return "0%";
  return ((engagements / reach) * 100).toFixed(1) + "%";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function avgStat(values: number[]): string {
  if (values.length === 0) return "—";
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return avg >= 1000 ? `${(avg / 1000).toFixed(1)}k` : Math.round(avg).toLocaleString();
}

// ── Platform icon SVGs ────────────────────────────────────────────

function PlatformIcon({ platform, size = 16 }: { platform: string; size?: number }) {
  if (platform === "Facebook") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#1877F2">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    );
  }
  if (platform === "Instagram") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#E1306C">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
      </svg>
    );
  }
  if (platform === "TikTok") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#EE1D52">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z" />
      </svg>
    );
  }
  return null;
}

// ── Persistent product context bar ───────────────────────────────

function ProductContextBar({
  products,
  productId,
  onChange,
}: {
  products: Product[];
  productId: string;
  onChange: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const selected = products.find((p) => p.id === productId);

  if (products.length === 0) return null;

  return (
    <div
      className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg"
      style={{
        background: "var(--mk-paper)",
        border: "1px solid var(--mk-rule)",
      }}
    >
      <span
        className="inline-block rounded-full shrink-0"
        style={{ width: 6, height: 6, background: "var(--mk-accent)" }}
      />
      <span
        className="font-mono text-[9.5px] uppercase shrink-0"
        style={{ color: "var(--mk-ink-40)", letterSpacing: "0.18em" }}
      >
        Product
      </span>

      {editing ? (
        <select
          autoFocus
          value={productId}
          onChange={(e) => { onChange(e.target.value); setEditing(false); }}
          onBlur={() => setEditing(false)}
          className="flex-1 min-w-0 bg-transparent border-none outline-none cursor-pointer text-[13px] font-medium"
          style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      ) : (
        <>
          <span
            className="flex-1 text-[13px] font-medium truncate min-w-0"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
          >
            {selected?.name ?? "No product selected"}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 text-[11px] px-2 py-1 rounded transition-colors"
            style={{ color: "var(--mk-ink-60)" }}
          >
            Change
          </button>
        </>
      )}
    </div>
  );
}

// ── Date range selector ──────────────────────────────────────────

function RangeSelector({
  value,
  onChange,
}: {
  value: Range;
  onChange: (r: Range) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="flex items-center gap-0.5 p-1 rounded-lg shrink-0"
      style={{
        background: "var(--mk-paper)",
        border: "1px solid var(--mk-rule)",
      }}
    >
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          aria-pressed={value === r}
          className="px-2.5 py-1.5 rounded-md font-mono text-[10px] uppercase transition-colors"
          style={{
            letterSpacing: "0.12em",
            ...(value === r ? pillStyle("ink") : { color: "var(--mk-ink-60)" }),
          }}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────

function AnalyticsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [tipsLoading, setTipsLoading] = useState(false);

  // Date range lives in the URL (?range=30d) so views are shareable and
  // survive refresh. 7d is the default and keeps the URL clean.
  const rangeParam = searchParams.get("range");
  const range: Range = RANGES.includes(rangeParam as Range) ? (rangeParam as Range) : "7d";

  const handleRangeChange = useCallback(
    (r: Range) => {
      const params = new URLSearchParams(searchParams.toString());
      if (r === "7d") params.delete("range");
      else params.set("range", r);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  // Optimistically select the persisted product on mount so its insights
  // fetch kicks off in parallel with the products fetch (no waterfall).
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setProductId(saved);
  }, []);

  // Load products; keep the optimistic selection if it's still valid,
  // otherwise fall back to the first product.
  const fetchProducts = useCallback(async () => {
    const res = await apiGet<{ products: Product[] }>("/api/products");
    if (!res.ok) return;
    const list: Product[] = res.data.products || [];
    setProducts(list);
    if (list.length === 0) return;
    setProductId((current) =>
      current && list.some((p) => p.id === current) ? current : list[0].id
    );
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Cached insights query — revisits and range/product switches that hit the
  // cache render instantly and revalidate in the background.
  const insightsKey = productId ? `${productId}:${range}` : "";
  const {
    data: insights,
    loading: insightsLoading,
    refreshing: insightsRefreshing,
    refresh: refreshInsights,
  } = useApiQuery<UnifiedInsights>(
    productId ? `/api/insights/${productId}?range=${range}` : null
  );

  const handleProductChange = (id: string) => {
    setProductId(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
  };

  // Tips are tied to the product+range they were generated for; stale tips
  // simply stop rendering when the key changes (no effect needed).
  const [tipsResult, setTipsResult] = useState<{ key: string; tips: Tip[] } | null>(null);
  const tips = tipsResult && tipsResult.key === insightsKey ? tipsResult.tips : null;

  const fetchTips = async () => {
    if (!productId || !insights) return;
    setTipsLoading(true);
    try {
      const res = await apiPost<{ tips: Tip[] }>(`/api/insights/${productId}/tips`, { insights });
      if (res.ok) setTipsResult({ key: insightsKey, tips: res.data.tips });
    } catch { /* silent */ }
    finally { setTipsLoading(false); }
  };

  const anyConnected = insights && (
    insights.facebook.connected || insights.instagram.connected || insights.tiktok.connected
  );

  return (
    <AppShell>
      <FeatureGate feature="advancedAnalytics">
        <PageHeader
          title="Analytics"
          subtitle="AI-powered insights and recommendations for your social media presence."
          action={
            insights && (
              <Button
                variant="outline"
                className="rounded-lg h-9 text-[13px]"
                onClick={() => refreshInsights()}
                disabled={insightsLoading || insightsRefreshing}
              >
                {insightsLoading || insightsRefreshing ? "Refreshing…" : "Refresh"}
              </Button>
            )
          }
        />

        {/* Persistent product selector + date range */}
        {products.length > 0 && (
          <div className="flex items-stretch gap-3 mb-6 flex-wrap">
            <div className="flex-1 min-w-0">
              <ProductContextBar
                products={products}
                productId={productId}
                onChange={handleProductChange}
              />
            </div>
            <RangeSelector value={range} onChange={handleRangeChange} />
          </div>
        )}

        {/* Loading skeletons — mirror the platform health card layout */}
        {insightsLoading && (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-border/50 bg-card p-5 space-y-4">
                {/* Header: platform name + connection status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="h-3 w-16" />
                </div>
                {/* Profile row */}
                <div className="flex items-start gap-3">
                  <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5 pt-0.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <div key={j} className="space-y-1.5">
                      <Skeleton className="h-5 w-14" />
                      <Skeleton className="h-2.5 w-16" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state — no product */}
        {!productId && !insightsLoading && (
          <Card className="border-border/30">
            <CardContent className="py-16 text-center">
              <p className="text-base font-medium">Select a product to view analytics</p>
              <p className="text-sm text-muted-foreground mt-1">
                Choose a product above to pull data from your connected platforms.
              </p>
            </CardContent>
          </Card>
        )}

        {insights && !insightsLoading && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease }}
            className="space-y-6"
          >
            {/* Platform health cards */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              <PlatformHealthCard
                platform="Facebook"
                connected={insights.facebook.connected}
                error={insights.facebook.error}
                profile={insights.facebook.connected && !insights.facebook.error ? {
                  avatarUrl: insights.facebook.avatarUrl,
                  displayName: insights.facebook.pageName,
                  username: insights.facebook.username,
                  isVerified: insights.facebook.isVerified,
                  bio: insights.facebook.bio,
                  profileUrl: insights.facebook.profileUrl,
                } : undefined}
                stats={insights.facebook.connected && !insights.facebook.error ? [
                  { label: "Followers", value: insights.facebook.followers?.toLocaleString() || "—" },
                  { label: `Reach (${range})`, value: (insights.facebook.reach ?? insights.facebook.reach7d)?.toLocaleString() || "—" },
                  { label: `Engagements (${range})`, value: (insights.facebook.engagements ?? insights.facebook.engagements7d)?.toLocaleString() || "—" },
                  { label: "Eng. Rate", value: engagementRate(insights.facebook.engagements ?? insights.facebook.engagements7d ?? 0, insights.facebook.reach ?? insights.facebook.reach7d ?? 0) },
                  { label: "Avg. Views", value: avgStat(insights.facebook.recentPosts?.map((p) => p.views ?? 0).filter((v) => v > 0) || []) },
                  { label: "Posts", value: insights.facebook.recentPosts?.length.toString() || "—" },
                ] : undefined}
              />
              <PlatformHealthCard
                platform="Instagram"
                connected={insights.instagram.connected}
                error={insights.instagram.error}
                profile={insights.instagram.connected && !insights.instagram.error ? {
                  avatarUrl: insights.instagram.avatarUrl,
                  displayName: insights.instagram.displayName,
                  username: insights.instagram.username,
                  bio: insights.instagram.bio,
                  profileUrl: insights.instagram.profileUrl,
                } : undefined}
                stats={insights.instagram.connected && !insights.instagram.error ? [
                  { label: "Followers", value: insights.instagram.followersCount?.toLocaleString() || "—" },
                  { label: "Following", value: insights.instagram.follows?.toLocaleString() || "—" },
                  { label: "Total Posts", value: insights.instagram.mediaCount?.toLocaleString() || "—" },
                  { label: "Avg. Views", value: avgStat(insights.instagram.recentMedia?.map((m) => m.views ?? 0).filter((v) => v > 0) || []) },
                  { label: "Avg. Likes", value: avgStat(insights.instagram.recentMedia?.map((m) => m.likes) || []) },
                  { label: "Avg. Reach", value: avgStat(insights.instagram.recentMedia?.map((m) => m.reach ?? 0).filter((v) => v > 0) || []) },
                ] : undefined}
              />
              <PlatformHealthCard
                platform="TikTok"
                connected={insights.tiktok.connected}
                error={insights.tiktok.error}
                profile={insights.tiktok.connected && !insights.tiktok.error ? {
                  avatarUrl: insights.tiktok.avatarUrl,
                  displayName: insights.tiktok.displayName,
                  username: insights.tiktok.username,
                  isVerified: insights.tiktok.isVerified,
                  bio: insights.tiktok.bioDescription,
                  profileUrl: insights.tiktok.profileDeepLink,
                } : undefined}
                stats={insights.tiktok.connected && !insights.tiktok.error ? [
                  { label: "Followers", value: insights.tiktok.followers?.toLocaleString() || "—" },
                  { label: "Following", value: insights.tiktok.following?.toLocaleString() || "—" },
                  { label: "Total Likes", value: insights.tiktok.totalLikes?.toLocaleString() || "—" },
                  { label: "Videos", value: insights.tiktok.videoCount?.toLocaleString() || "—" },
                  { label: "Avg. Views", value: avgStat(insights.tiktok.recentVideos?.map((v) => v.views) || []) },
                  { label: "Avg. Likes", value: avgStat(insights.tiktok.recentVideos?.map((v) => v.likes) || []) },
                ] : undefined}
              />
            </div>

            {/* Follower comparison chart */}
            {anyConnected && <FollowerComparisonChart insights={insights} />}

            {/* AI tips */}
            {anyConnected && (
              <Card className="border-border/30">
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">AI Recommendations</CardTitle>
                      <CardDescription>Personalized tips based on your live platform data.</CardDescription>
                    </div>
                    <Button onClick={fetchTips} disabled={tipsLoading} className="rounded-xl shrink-0">
                      {tipsLoading ? "Analyzing…" : tips ? "Refresh" : "Get AI Tips"}
                    </Button>
                  </div>
                </CardHeader>
                {tips && (
                  <CardContent>
                    <div className="grid gap-3 md:grid-cols-2">
                      {tips.map((tip, i) => (
                        <div key={i} className="rounded-xl border border-border/40 p-4 space-y-2">
                          <div className="flex items-start gap-2 flex-wrap">
                            <p className="text-sm font-semibold flex-1 min-w-0">{tip.title}</p>
                            <Badge
                              variant="outline"
                              className="border-0 text-[10px] shrink-0 capitalize"
                              style={pillStyle(priorityTone[tip.priority] ?? "neutral")}
                            >
                              {tip.priority}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="border-0 text-[10px] shrink-0 capitalize"
                              style={platformBadgeStyle(tip.platform)}
                            >
                              {tip.platform}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">{tip.tip}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

            {/* Top performing content */}
            {insights.facebook.connected && (insights.facebook.recentPosts?.length ?? 0) > 0 && (
              <TopPostsCard
                platform="Facebook"
                title="Top Facebook Posts"
                posts={
                  [...(insights.facebook.recentPosts ?? [])]
                    .sort((a, b) => (b.likes + b.comments + b.shares) - (a.likes + a.comments + a.shares))
                    .slice(0, 5)
                    .map((p) => ({
                      id: p.id,
                      text: p.message || "(no text)",
                      imageUrl: p.imageUrl,
                      date: p.createdTime,
                      views: p.views,
                      likes: p.likes,
                      comments: p.comments,
                      shares: p.shares,
                      permalink: p.permalink,
                    }))
                }
              />
            )}

            {insights.instagram.connected && (insights.instagram.recentMedia?.length ?? 0) > 0 && (
              <TopPostsCard
                platform="Instagram"
                title="Top Instagram Posts"
                posts={
                  [...(insights.instagram.recentMedia ?? [])]
                    .sort((a, b) => ((b.views ?? 0) + b.likes + b.comments) - ((a.views ?? 0) + a.likes + a.comments))
                    .slice(0, 5)
                    .map((m) => ({
                      id: m.id,
                      text: m.caption || "(no caption)",
                      imageUrl: m.mediaUrl || m.thumbnailUrl,
                      date: m.timestamp,
                      views: m.views,
                      likes: m.likes,
                      comments: m.comments,
                      shares: m.shares,
                      permalink: m.permalink,
                    }))
                }
              />
            )}

            {insights.tiktok.connected && (insights.tiktok.recentVideos?.length ?? 0) > 0 && (
              <TopPostsCard
                platform="TikTok"
                title="Top TikTok Videos"
                posts={
                  [...(insights.tiktok.recentVideos ?? [])]
                    .sort((a, b) => b.views - a.views)
                    .slice(0, 5)
                    .map((v) => ({
                      id: v.id,
                      text: v.title || "(untitled)",
                      imageUrl: v.coverUrl,
                      date: new Date(v.createTime * 1000).toISOString(),
                      views: v.views,
                      likes: v.likes,
                      comments: v.comments,
                      shares: v.shares,
                      permalink: v.shareUrl,
                    }))
                }
              />
            )}

            {!anyConnected && (
              <Card className="border-border/30">
                <CardContent className="py-16 text-center">
                  <p className="text-base font-medium">No platforms connected</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connect Meta or TikTok in{" "}
                    <a href="/products" className="text-primary hover:underline">Products → Edit</a>{" "}
                    to see insights and get AI recommendations.
                  </p>
                </CardContent>
              </Card>
            )}
          </motion.div>
        )}
      </FeatureGate>
    </AppShell>
  );
}

// useSearchParams requires a Suspense boundary during prerendering.
export default function AnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsPageContent />
    </Suspense>
  );
}

// ── Subcomponents ────────────────────────────────────────────────

function PlatformHealthCard({
  platform,
  connected,
  error,
  stats,
  profile,
}: {
  platform: string;
  connected: boolean;
  error?: string;
  stats?: { label: string; value: string }[];
  profile?: {
    avatarUrl?: string;
    displayName?: string;
    username?: string;
    isVerified?: boolean;
    bio?: string;
    profileUrl?: string;
  };
}) {
  const isOk = connected && !error;

  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4 hover:border-border/80 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={platform} size={15} />
          <span className="text-sm font-semibold">{platform}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: isOk
                ? "var(--mk-pos)"
                : connected
                ? "var(--mk-warn)"
                : "var(--mk-ink-20)",
            }}
          />
          <span
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{
              color: isOk
                ? "var(--mk-pos)"
                : connected
                ? "var(--mk-warn)"
                : "var(--mk-ink-60)",
            }}
          >
            {isOk ? "Connected" : connected ? "Limited" : "Not connected"}
          </span>
        </div>
      </div>

      {/* Profile */}
      {profile && (profile.displayName || profile.username || profile.bio) && (
        <div className="flex items-start gap-3">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              className="w-10 h-10 rounded-full object-cover shrink-0 border border-border/30"
            />
          ) : null}
          <div className="min-w-0 flex-1 space-y-0.5">
            {(profile.displayName || profile.username) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-medium truncate">
                  {profile.displayName || profile.username}
                </p>
                {profile.isVerified && (
                  <span
                    title="Verified"
                    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] leading-none shrink-0"
                    style={{ background: "var(--mk-accent)", color: "var(--mk-accent-ink)" }}
                  >
                    ✓
                  </span>
                )}
                {profile.username && profile.displayName && (
                  <span className="text-[11px] text-muted-foreground truncate">
                    @{profile.username}
                  </span>
                )}
              </div>
            )}
            {profile.bio && (
              <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                {profile.bio}
              </p>
            )}
            {profile.profileUrl && (
              <a
                href={profile.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-primary hover:underline"
              >
                View profile →
              </a>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      {stats ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="text-xl font-light tabular-nums tracking-tight">{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      ) : error ? (
        <p
          className="text-[12px] leading-relaxed"
          style={{ color: "var(--mk-warn)" }}
        >
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Connect in{" "}
          <a href="/products" className="text-primary hover:underline">Products</a>{" "}
          to see insights.
        </p>
      )}
    </div>
  );
}

function FollowerComparisonChart({ insights }: { insights: UnifiedInsights }) {
  const data: { platform: string; followers: number }[] = [];
  if (insights.facebook.connected && insights.facebook.followers)
    data.push({ platform: "Facebook", followers: insights.facebook.followers });
  if (insights.instagram.connected && insights.instagram.followersCount)
    data.push({ platform: "Instagram", followers: insights.instagram.followersCount });
  if (insights.tiktok.connected && insights.tiktok.followers)
    data.push({ platform: "TikTok", followers: insights.tiktok.followers });

  if (data.length < 2) return null;

  return (
    <Card className="border-border/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Audience Size</CardTitle>
        <CardDescription>Follower count across connected platforms.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--mk-rule-soft)" />
            <XAxis
              dataKey="platform"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--mk-ink-60)" }}
            />
            <YAxis
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--mk-ink-40)" }}
              tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--mk-rule)",
                background: "var(--mk-paper)",
                color: "var(--mk-ink)",
                fontSize: 12,
              }}
              cursor={{ fill: "var(--mk-panel)" }}
            />
            <Bar dataKey="followers" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.platform} fill={platformBarColors[entry.platform] || "var(--mk-accent)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TopPostsCard({
  platform,
  title,
  posts,
}: {
  platform: string;
  title: string;
  posts: {
    id: string; text: string; imageUrl?: string; date: string;
    likes?: number; comments?: number; shares?: number; views?: number;
    permalink?: string;
  }[];
}) {
  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={platform} size={14} />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <CardDescription>Sorted by engagement.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/30">
          {posts.map((post) => (
            <div key={post.id} className="flex gap-3 py-3 first:pt-0 last:pb-0 group">
              {/* Thumbnail */}
              {post.imageUrl ? (
                <img
                  src={post.imageUrl}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover shrink-0 border border-border/30"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-muted/40 flex items-center justify-center shrink-0 border border-border/20">
                  <PlatformIcon platform={platform} size={18} />
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm leading-snug line-clamp-2 text-foreground/85">{post.text}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{timeAgo(post.date)}</span>
                  {post.views != null && <span>{post.views.toLocaleString()} views</span>}
                  {post.likes != null && <span>{post.likes.toLocaleString()} likes</span>}
                  {post.comments != null && <span>{post.comments.toLocaleString()} comments</span>}
                  {post.shares != null && <span>{post.shares.toLocaleString()} shares</span>}
                  {post.permalink && (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                    >
                      View
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
