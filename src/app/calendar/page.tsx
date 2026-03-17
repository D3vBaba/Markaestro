"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type Post = {
  id: string;
  content: string;
  channel: string;
  status: string;
  scheduledAt?: string | null;
  publishedAt?: string;
  externalUrl?: string;
  createdAt?: string;
  errorMessage?: string;
};

type AdCampaign = {
  id: string;
  name: string;
  platform: string;
  status: string;
  startDate: string;
  endDate?: string | null;
  dailyBudgetCents?: number;
};

type CalendarItem =
  | { kind: "post"; date: string; post: Post }
  | { kind: "ad"; date: string; ad: AdCampaign };

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  x: "X",
  facebook: "FB",
  instagram: "IG",
  tiktok: "TT",
};

const POST_STATUS_COLORS: Record<string, string> = {
  published: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  scheduled: "bg-blue-500/10 text-blue-700 border-blue-200",
  draft: "bg-muted text-muted-foreground border-border",
  failed: "bg-red-500/10 text-red-700 border-red-200",
};

const AD_STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  pending: "bg-amber-500/10 text-amber-700 border-amber-200",
  paused: "bg-amber-500/10 text-amber-700 border-amber-200",
  draft: "bg-muted text-muted-foreground border-border",
  completed: "bg-muted text-muted-foreground border-border",
  failed: "bg-red-500/10 text-red-700 border-red-200",
};

function isoDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function getDateForPost(p: Post): string | null {
  if (p.publishedAt) return isoDateStr(new Date(p.publishedAt));
  if (p.scheduledAt) return isoDateStr(new Date(p.scheduledAt));
  return null;
}

function getDaysInMonth(year: number, month: number) {
  // Returns array of Date objects for all days in the calendar grid (including padding)
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay(); // 0 = Sunday

  const days: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
  // Fill to complete last row
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Preview Sheet ─────────────────────────────────────────────────────────────

function PostPreviewSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  const date = post.publishedAt
    ? new Date(post.publishedAt).toLocaleString()
    : post.scheduledAt
    ? new Date(post.scheduledAt).toLocaleString()
    : "";

  return (
    <SheetContent className="overflow-y-auto">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <span>{CHANNEL_LABELS[post.channel] || post.channel}</span>
          <Badge variant="outline" className={`text-[10px] capitalize ${POST_STATUS_COLORS[post.status] || ""}`}>
            {post.status}
          </Badge>
        </SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-4">
        {date && (
          <p className="text-xs text-muted-foreground">
            {post.status === "published" ? "Published" : "Scheduled"}: {date}
          </p>
        )}
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
        </div>
        {post.errorMessage && (
          <p className="text-xs text-destructive">{post.errorMessage}</p>
        )}
        {post.externalUrl && (
          <a
            href={post.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline text-muted-foreground hover:text-foreground"
          >
            View live post →
          </a>
        )}
      </div>
    </SheetContent>
  );
}

function AdPreviewSheet({ ad, onClose }: { ad: AdCampaign; onClose: () => void }) {
  return (
    <SheetContent className="overflow-y-auto">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <span>{ad.name}</span>
          <Badge variant="outline" className={`text-[10px] capitalize ${AD_STATUS_COLORS[ad.status] || ""}`}>
            {ad.status}
          </Badge>
        </SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span className="capitalize">{ad.platform}</span>
          {ad.dailyBudgetCents && (
            <>
              <span>·</span>
              <span>${(ad.dailyBudgetCents / 100).toFixed(0)}/day</span>
            </>
          )}
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-1 text-xs text-muted-foreground">
          <p>Start: {new Date(ad.startDate).toLocaleDateString()}</p>
          {ad.endDate && <p>End: {new Date(ad.endDate).toLocaleDateString()}</p>}
        </div>
      </div>
    </SheetContent>
  );
}

// ── Calendar Cell Item ────────────────────────────────────────────────────────

function CalendarChip({
  item,
  onClick,
}: {
  item: CalendarItem;
  onClick: () => void;
}) {
  if (item.kind === "post") {
    const p = item.post;
    const colorClass = POST_STATUS_COLORS[p.status] || POST_STATUS_COLORS.draft;
    return (
      <button
        onClick={onClick}
        className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] leading-tight border truncate transition-opacity hover:opacity-80 ${colorClass}`}
      >
        <span className="font-medium">{CHANNEL_LABELS[p.channel] || p.channel}</span>{" "}
        <span className="opacity-80">{p.content.slice(0, 28)}</span>
      </button>
    );
  }

  const colorClass = AD_STATUS_COLORS[item.ad.status] || AD_STATUS_COLORS.draft;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] leading-tight border truncate transition-opacity hover:opacity-80 ${colorClass}`}
    >
      <span className="font-medium">Ad</span>{" "}
      <span className="opacity-80">{item.ad.name}</span>
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [posts, setPosts] = useState<Post[]>([]);
  const [ads, setAds] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CalendarItem | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [postRes, adRes] = await Promise.all([
        apiGet<{ posts: Post[] }>("/api/posts?limit=200"),
        apiGet<{ campaigns: AdCampaign[] }>("/api/ad-campaigns?limit=200"),
      ]);
      if (postRes.ok) setPosts(postRes.data.posts || []);
      if (adRes.ok) setAds(adRes.data.campaigns || []);
    } catch {
      toast.error("Failed to load calendar data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build a map of dateStr → CalendarItem[]
  const itemsByDate = new Map<string, CalendarItem[]>();

  for (const post of posts) {
    const date = getDateForPost(post);
    if (!date) continue;
    if (!itemsByDate.has(date)) itemsByDate.set(date, []);
    itemsByDate.get(date)!.push({ kind: "post", date, post });
  }

  for (const ad of ads) {
    // Show ad on its startDate
    if (!ad.startDate) continue;
    const date = isoDateStr(new Date(ad.startDate));
    if (!itemsByDate.has(date)) itemsByDate.set(date, []);
    itemsByDate.get(date)!.push({ kind: "ad", date, ad });
  }

  const days = getDaysInMonth(year, month);
  const todayStr = isoDateStr(today);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  return (
    <AppShell>
      <PageHeader
        title="Calendar"
        subtitle="Scheduled posts and ad campaigns at a glance."
      />

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">
          {MONTH_NAMES[month]} {year}
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-8"
            onClick={() => { setMonth(today.getMonth()); setYear(today.getFullYear()); }}
          >
            Today
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {[
          { label: "Published", cls: "bg-emerald-500/10 border-emerald-200" },
          { label: "Scheduled", cls: "bg-blue-500/10 border-blue-200" },
          { label: "Ad campaign", cls: "bg-amber-500/10 border-amber-200" },
          { label: "Failed", cls: "bg-red-500/10 border-red-200" },
        ].map(({ label, cls }) => (
          <span key={label} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] text-muted-foreground ${cls}`}>
            {label}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-5 w-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
        </div>
      ) : (
        <div className="rounded-xl border border-border/40 overflow-hidden">
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 border-b border-border/40 bg-muted/30">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2 text-center text-[11px] font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 divide-x divide-y divide-border/30">
            {days.map((day, idx) => {
              if (!day) {
                return <div key={`pad-${idx}`} className="min-h-[100px] bg-muted/10 p-1" />;
              }
              const dateStr = isoDateStr(day);
              const isToday = dateStr === todayStr;
              const items = itemsByDate.get(dateStr) || [];
              const MAX_VISIBLE = 3;
              const overflow = items.length - MAX_VISIBLE;

              return (
                <div
                  key={dateStr}
                  className={`min-h-[100px] p-1.5 space-y-1 ${isToday ? "bg-primary/5" : "bg-background"}`}
                >
                  <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? "bg-foreground text-background" : "text-muted-foreground"
                  }`}>
                    {day.getDate()}
                  </div>
                  {items.slice(0, MAX_VISIBLE).map((item, i) => (
                    <CalendarChip
                      key={i}
                      item={item}
                      onClick={() => setSelected(item)}
                    />
                  ))}
                  {overflow > 0 && (
                    <button
                      className="text-[10px] text-muted-foreground hover:text-foreground pl-1"
                      onClick={() => setSelected(items[MAX_VISIBLE])}
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview sheet */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        {selected?.kind === "post" && (
          <PostPreviewSheet post={selected.post} onClose={() => setSelected(null)} />
        )}
        {selected?.kind === "ad" && (
          <AdPreviewSheet ad={selected.ad} onClose={() => setSelected(null)} />
        )}
      </Sheet>
    </AppShell>
  );
}
