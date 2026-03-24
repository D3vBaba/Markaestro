"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import ProductPicker from "@/app/content/_components/ProductPicker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Sparkles, RefreshCw, Heart, MessageCircle, Share2, Play, ExternalLink, ImageIcon } from "lucide-react";
import { motion } from "framer-motion";

// ── Types ────────────────────────────────────────────────────────

type FacebookPost = {
  id: string; message?: string; imageUrl?: string; createdTime: string;
  likes: number; comments: number; shares: number;
};

type InstagramMedia = {
  id: string; caption?: string; mediaType: string; mediaUrl?: string;
  thumbnailUrl?: string; timestamp: string; likes: number; comments: number;
  permalink?: string;
};

type TikTokVideo = {
  id: string; title?: string; coverUrl?: string; createTime: number;
  shareUrl?: string; views: number; likes: number; comments: number; shares: number;
};

type FacebookInsights = {
  platform: "facebook"; connected: boolean; error?: string;
  pageName?: string; followers?: number; impressions7d?: number;
  engagements7d?: number; reach7d?: number; recentPosts?: FacebookPost[];
};

type InstagramInsights = {
  platform: "instagram"; connected: boolean; error?: string;
  followersCount?: number; mediaCount?: number; recentMedia?: InstagramMedia[];
};

type TikTokInsights = {
  platform: "tiktok"; connected: boolean; error?: string;
  displayName?: string; avatarUrl?: string; followers?: number;
  following?: number; totalLikes?: number; videoCount?: number;
  recentVideos?: TikTokVideo[];
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

// ── Helpers ──────────────────────────────────────────────────────

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const priorityColors: Record<string, string> = {
  high: "bg-rose-50 text-rose-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-blue-50 text-blue-700",
};

const platformColors: Record<string, string> = {
  facebook: "bg-blue-50 text-blue-700",
  instagram: "bg-pink-50 text-pink-700",
  tiktok: "bg-zinc-100 text-zinc-800",
  "cross-platform": "bg-violet-50 text-violet-700",
  ads: "bg-emerald-50 text-emerald-700",
};

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

// ── Component ────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [productId, setProductId] = useState("");
  const [insights, setInsights] = useState<UnifiedInsights | null>(null);
  const [tips, setTips] = useState<Tip[] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [tipsLoading, setTipsLoading] = useState(false);

  const fetchInsights = useCallback(async (pid: string) => {
    if (!pid) return;
    setInsightsLoading(true);
    setInsights(null);
    setTips(null);
    try {
      const res = await apiGet<UnifiedInsights>(`/api/insights/${pid}`);
      if (res.ok) setInsights(res.data);
    } catch { /* silent */ }
    finally { setInsightsLoading(false); }
  }, []);

  useEffect(() => {
    if (productId) fetchInsights(productId);
  }, [productId, fetchInsights]);

  const fetchTips = async () => {
    if (!productId || !insights) return;
    setTipsLoading(true);
    try {
      const res = await apiPost<{ tips: Tip[] }>(`/api/insights/${productId}/tips`, { insights });
      if (res.ok) setTips(res.data.tips);
    } catch { /* silent */ }
    finally { setTipsLoading(false); }
  };

  const anyConnected = insights && (insights.facebook.connected || insights.instagram.connected || insights.tiktok.connected);

  return (
    <AppShell>
      <PageHeader
        title="Social Manager"
        subtitle="AI-powered insights and recommendations for your social media presence."
        action={
          insights && (
            <Button variant="outline" className="rounded-xl" onClick={() => fetchInsights(productId)} disabled={insightsLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${insightsLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          )
        }
      />

      {/* Product Picker */}
      <div className="mb-8">
        <ProductPicker value={productId} onChange={setProductId} />
      </div>

      {!productId && (
        <Card className="border-border/30">
          <CardContent className="py-16 text-center">
            <p className="text-base font-medium">Select a product to view social media insights</p>
            <p className="text-sm text-muted-foreground mt-1">Choose a product above to pull data from your connected platforms.</p>
          </CardContent>
        </Card>
      )}

      {insightsLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {insights && !insightsLoading && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
          className="space-y-6"
        >
          {/* Platform Health Cards */}
          <div className="grid gap-5 md:grid-cols-3">
            <PlatformHealthCard
              platform="Facebook"
              connected={insights.facebook.connected}
              error={insights.facebook.error}
              stats={insights.facebook.connected && !insights.facebook.error ? [
                { label: "Followers", value: insights.facebook.followers?.toLocaleString() || "—" },
                { label: "Reach (7d)", value: insights.facebook.reach7d?.toLocaleString() || "—" },
                { label: "Engagements (7d)", value: insights.facebook.engagements7d?.toLocaleString() || "—" },
                { label: "Engagement Rate", value: engagementRate(insights.facebook.engagements7d || 0, insights.facebook.reach7d || 0) },
              ] : undefined}
            />
            <PlatformHealthCard
              platform="Instagram"
              connected={insights.instagram.connected}
              error={insights.instagram.error}
              stats={insights.instagram.connected && !insights.instagram.error ? [
                { label: "Followers", value: insights.instagram.followersCount?.toLocaleString() || "—" },
                { label: "Total Posts", value: insights.instagram.mediaCount?.toLocaleString() || "—" },
                { label: "Avg. Likes", value: avgStat(insights.instagram.recentMedia?.map((m) => m.likes) || []) },
                { label: "Avg. Comments", value: avgStat(insights.instagram.recentMedia?.map((m) => m.comments) || []) },
              ] : undefined}
            />
            <PlatformHealthCard
              platform="TikTok"
              connected={insights.tiktok.connected}
              error={insights.tiktok.error}
              stats={insights.tiktok.connected && !insights.tiktok.error ? [
                { label: "Followers", value: insights.tiktok.followers?.toLocaleString() || "—" },
                { label: "Total Likes", value: insights.tiktok.totalLikes?.toLocaleString() || "—" },
                { label: "Videos", value: insights.tiktok.videoCount?.toLocaleString() || "—" },
                { label: "Avg. Views", value: avgStat(insights.tiktok.recentVideos?.map((v) => v.views) || []) },
              ] : undefined}
            />
          </div>

          {/* Cross-Platform Comparison Chart */}
          {anyConnected && <FollowerComparisonChart insights={insights} />}

          {/* AI Tips */}
          {anyConnected && (
            <Card className="border-border/30">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      AI Social Media Manager
                    </CardTitle>
                    <CardDescription>Personalized recommendations based on your live platform data.</CardDescription>
                  </div>
                  <Button onClick={fetchTips} disabled={tipsLoading} className="rounded-xl">
                    {tipsLoading ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Analyzing...</>
                    ) : tips ? (
                      <><RefreshCw className="h-4 w-4 mr-2" /> Refresh Tips</>
                    ) : (
                      <><Sparkles className="h-4 w-4 mr-2" /> Get AI Tips</>
                    )}
                  </Button>
                </div>
              </CardHeader>
              {tips && (
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-2">
                    {tips.map((tip, i) => (
                      <div key={i} className="rounded-xl border border-border/40 p-4 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{tip.title}</p>
                          <Badge variant="outline" className={`border-0 text-[10px] ${priorityColors[tip.priority] || ""}`}>
                            {tip.priority}
                          </Badge>
                          <Badge variant="outline" className={`border-0 text-[10px] ${platformColors[tip.platform] || "bg-muted"}`}>
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

          {/* Top Performing Content */}
          {insights.facebook.connected && insights.facebook.recentPosts && insights.facebook.recentPosts.length > 0 && (
            <TopPostsCard title="Top Facebook Posts" posts={
              [...insights.facebook.recentPosts]
                .sort((a, b) => (b.likes + b.comments + b.shares) - (a.likes + a.comments + a.shares))
                .slice(0, 5)
                .map((p) => ({
                  id: p.id,
                  text: p.message || "(no text)",
                  imageUrl: p.imageUrl,
                  date: p.createdTime,
                  likes: p.likes,
                  comments: p.comments,
                  shares: p.shares,
                }))
            } />
          )}

          {insights.instagram.connected && insights.instagram.recentMedia && insights.instagram.recentMedia.length > 0 && (
            <TopPostsCard title="Top Instagram Posts" posts={
              [...insights.instagram.recentMedia]
                .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
                .slice(0, 5)
                .map((m) => ({
                  id: m.id,
                  text: m.caption || "(no caption)",
                  imageUrl: m.mediaUrl || m.thumbnailUrl,
                  date: m.timestamp,
                  likes: m.likes,
                  comments: m.comments,
                  permalink: m.permalink,
                }))
            } />
          )}

          {insights.tiktok.connected && insights.tiktok.recentVideos && insights.tiktok.recentVideos.length > 0 && (
            <TopPostsCard title="Top TikTok Videos" posts={
              [...insights.tiktok.recentVideos]
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
            } />
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
    </AppShell>
  );
}

// ── Subcomponents ────────────────────────────────────────────────

function PlatformHealthCard({ platform, connected, error, stats }: {
  platform: string;
  connected: boolean;
  error?: string;
  stats?: { label: string; value: string }[];
}) {
  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{platform}</CardTitle>
          <Badge variant="outline" className={`border-0 text-[10px] ${
            connected && !error
              ? "bg-emerald-50 text-emerald-700"
              : connected && error
              ? "bg-amber-50 text-amber-700"
              : "bg-muted text-muted-foreground"
          }`}>
            {connected && !error ? "Connected" : connected && error ? "Limited" : "Not connected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {stats ? (
          <div className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="text-lg font-bold tracking-tight">{s.value}</p>
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="text-xs text-amber-600">{error}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Connect in <a href="/products" className="text-primary hover:underline">Products</a> to see insights.
          </p>
        )}
      </CardContent>
    </Card>
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
      <CardHeader>
        <CardTitle className="text-base">Follower Comparison</CardTitle>
        <CardDescription>Audience size across connected platforms.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" opacity={0.6} />
            <XAxis dataKey="platform" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} />
            <Tooltip contentStyle={{ borderRadius: "12px", borderColor: "#e4e4e7" }} />
            <Bar dataKey="followers" fill="#2563eb" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TopPostsCard({ title, posts }: {
  title: string;
  posts: {
    id: string; text: string; imageUrl?: string; date: string;
    likes?: number; comments?: number; shares?: number; views?: number;
    permalink?: string;
  }[];
}) {
  return (
    <Card className="border-border/30">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Sorted by engagement.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="flex gap-3 group">
              {post.imageUrl ? (
                <img src={post.imageUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 border border-border/40" />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug line-clamp-2">{post.text}</p>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                  <span>{timeAgo(post.date)}</span>
                  {post.views != null && (
                    <span className="flex items-center gap-0.5"><Play className="h-3 w-3" />{post.views.toLocaleString()}</span>
                  )}
                  {post.likes != null && (
                    <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{post.likes.toLocaleString()}</span>
                  )}
                  {post.comments != null && (
                    <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{post.comments.toLocaleString()}</span>
                  )}
                  {post.shares != null && (
                    <span className="flex items-center gap-0.5"><Share2 className="h-3 w-3" />{post.shares.toLocaleString()}</span>
                  )}
                  {post.permalink && (
                    <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> View
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

function avgStat(values: number[]): string {
  if (values.length === 0) return "—";
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return avg >= 1000 ? `${(avg / 1000).toFixed(1)}k` : Math.round(avg).toLocaleString();
}
