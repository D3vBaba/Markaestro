"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X, ExternalLink, Heart, MessageCircle, Bookmark, Share2 } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  mediaUrls?: string[];
};

type AdCampaign = {
  id: string;
  name: string;
  platform: string;
  status: string;
  startDate: string;
  endDate?: string | null;
  dailyBudgetCents?: number;
  creative?: { headline?: string; primaryText?: string; imageUrl?: string };
};

type CalendarItem =
  | { kind: "post"; date: string; post: Post }
  | { kind: "ad"; date: string; ad: AdCampaign };

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_NAMES_SHORT = ["S","M","T","W","T","F","S"];

const CHANNEL_ACCENT: Record<string, string> = {
  instagram: "#E1306C",
  x:         "#14171A",
  facebook:  "#1877F2",
  tiktok:    "#EE1D52",
};

const CHANNEL_BG: Record<string, string> = {
  instagram: "rgba(225,48,108,0.08)",
  x:         "rgba(20,23,26,0.06)",
  facebook:  "rgba(24,119,242,0.08)",
  tiktok:    "rgba(238,29,82,0.08)",
};

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook:  "Facebook",
  tiktok:    "TikTok",
};

const STATUS_DOT: Record<string, string> = {
  published:  "#10b981",
  scheduled:  "#6366f1",
  draft:      "#9ca3af",
  failed:     "#ef4444",
  publishing: "#f59e0b",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

function getDateForPost(p: Post): string | null {
  if (p.publishedAt) return isoDate(new Date(p.publishedAt));
  if (p.scheduledAt) return isoDate(new Date(p.scheduledAt));
  return null;
}

function calendarDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// ─── Platform Mockups ─────────────────────────────────────────────────────────

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url);
}

function InstagramMockup({ post }: { post: Post }) {
  const img = post.mediaUrls?.[0];
  return (
    <div className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-md max-w-[320px] mx-auto">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full p-[2px]" style={{ background: "linear-gradient(135deg, #f9ce34, #ee2a7b, #6228d7)" }}>
            <div className="w-full h-full rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full" style={{ background: "linear-gradient(135deg, #f9ce34, #ee2a7b, #6228d7)" }} />
            </div>
          </div>
          <div>
            <p className="text-[12px] font-semibold leading-none text-zinc-900 dark:text-white">yourproduct</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">Sponsored</p>
          </div>
        </div>
        <span className="text-zinc-400 text-lg leading-none">···</span>
      </div>

      {img ? (
        isVideoUrl(img)
          ? <video src={img} className="w-full aspect-square object-cover" controls playsInline preload="metadata" />
          : <a href={img} target="_blank" rel="noopener noreferrer" className="block cursor-zoom-in"><img src={img} alt="" className="w-full aspect-square object-cover hover:opacity-90 transition-opacity" /></a>
      ) : (
        <div className="w-full aspect-square flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f9ce34, #ee2a7b, #6228d7)" }}>
          <svg className="w-10 h-10 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
          </svg>
        </div>
      )}

      <div className="px-3 pt-2.5 pb-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <Heart className="w-5 h-5 text-zinc-800 dark:text-zinc-200" />
            <MessageCircle className="w-5 h-5 text-zinc-800 dark:text-zinc-200" />
            <Share2 className="w-5 h-5 text-zinc-800 dark:text-zinc-200" />
          </div>
          <Bookmark className="w-5 h-5 text-zinc-800 dark:text-zinc-200" />
        </div>
        <p className="text-[12px] font-semibold text-zinc-900 dark:text-white">0 likes</p>
        <p className="text-[12px] text-zinc-900 dark:text-white leading-snug">
          <span className="font-semibold">yourproduct </span>
          {post.content.length > 120 ? post.content.slice(0, 120) + "… more" : post.content}
        </p>
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">just now</p>
      </div>
    </div>
  );
}

function FacebookMockup({ post }: { post: Post }) {
  const img = post.mediaUrls?.[0];
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#242526] shadow-md max-w-[320px] mx-auto overflow-hidden">
      <div className="flex items-start justify-between p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-[#1877F2] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-xl leading-none">f</span>
          </div>
          <div>
            <p className="text-[13px] font-semibold leading-none text-zinc-900 dark:text-[#e4e6ea]">Your Product</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">Just now · 🌐</p>
          </div>
        </div>
        <span className="text-zinc-400 text-lg">···</span>
      </div>
      <p className="px-3 pb-2 text-[13px] leading-snug text-zinc-900 dark:text-[#e4e6ea] whitespace-pre-wrap">
        {post.content.length > 200 ? post.content.slice(0, 200) + "…" : post.content}
      </p>
      {img && (
        isVideoUrl(img)
          ? <video src={img} className="w-full object-cover max-h-48" controls playsInline preload="metadata" />
          : <a href={img} target="_blank" rel="noopener noreferrer" className="block cursor-zoom-in"><img src={img} alt="" className="w-full object-cover max-h-48 hover:opacity-90 transition-opacity" /></a>
      )}
      <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-700/50">
        <div className="flex items-center justify-between text-[11px] text-zinc-500 pb-1.5">
          <span>👍 0</span><span>0 comments</span>
        </div>
        <div className="flex items-center justify-around border-t border-zinc-100 dark:border-zinc-700/50 pt-1.5">
          {["👍 Like","💬 Comment","↗ Share"].map((l) => (
            <button key={l} className="flex-1 text-center text-[12px] font-medium text-zinc-500 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-lg transition-colors">{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TikTokMockup({ post }: { post: Post }) {
  const img = post.mediaUrls?.[0];
  return (
    <div className="mx-auto" style={{ width: 180, aspectRatio: "9/16", position: "relative" }}>
      <div className="absolute inset-0 rounded-[28px] overflow-hidden bg-zinc-950 border border-zinc-800 shadow-2xl">
        {img ? (
          isVideoUrl(img)
            ? <video src={img} className="absolute inset-0 w-full h-full object-cover opacity-75" controls playsInline preload="metadata" />
            : <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover opacity-75" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-zinc-950" />
        )}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.15) 70%, rgba(0,0,0,0.3) 100%)" }} />

        <div className="absolute top-3 left-0 right-0 flex justify-center gap-5 text-[9px] text-white/70">
          <span>Following</span>
          <span className="font-bold text-white border-b border-white pb-0.5">For You</span>
        </div>

        <div className="absolute right-2 bottom-14 flex flex-col items-center gap-3">
          <div className="w-6 h-6 rounded-full border-2 border-white overflow-hidden">
            <div className="w-full h-full" style={{ background: "linear-gradient(135deg, #EE1D52, #69C9D0)" }} />
          </div>
          {[Heart, MessageCircle, Bookmark, Share2].map((Icon, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <Icon className="w-4 h-4 text-white" />
              <span className="text-[7px] text-white/80">0</span>
            </div>
          ))}
        </div>

        <div className="absolute bottom-0 left-0 right-7 p-2.5">
          <p className="text-[9px] font-bold text-white mb-0.5">@yourproduct</p>
          <p className="text-[8px] text-white/80 leading-tight line-clamp-3">{post.content}</p>
          <div className="flex items-center gap-1 mt-1.5">
            <div className="w-2.5 h-2.5 rounded-full animate-spin" style={{ background: "linear-gradient(135deg, #EE1D52, #69C9D0)", animationDuration: "3s" }} />
            <p className="text-[7px] text-white/50">Original sound</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Panels ────────────────────────────────────────────────────────────

function PostDetailPanel({ post, onClose }: { post: Post; onClose: () => void }) {
  const accent = CHANNEL_ACCENT[post.channel] || "#6366f1";
  const statusDate = post.publishedAt || post.scheduledAt;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
          <span className="text-sm font-semibold">{CHANNEL_LABEL[post.channel] || post.channel}</span>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border capitalize"
            style={{ color: STATUS_DOT[post.status], borderColor: STATUS_DOT[post.status] + "50", background: STATUS_DOT[post.status] + "12" }}
          >
            {post.status}
          </span>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {statusDate && (
          <p className="text-[11px] text-muted-foreground">
            {post.status === "published" ? "Published" : "Scheduled"} · {formatDate(statusDate)} at {formatTime(statusDate)}
          </p>
        )}

        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3 font-medium">Preview</p>
          {post.channel === "instagram" && <InstagramMockup post={post} />}
          {post.channel === "facebook"  && <FacebookMockup post={post} />}
          {post.channel === "tiktok"    && <TikTokMockup post={post} />}
          {!["instagram","facebook","tiktok"].includes(post.channel) && (
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
            </div>
          )}
        </div>

        {post.errorMessage && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-[12px] text-destructive">
            {post.errorMessage}
          </div>
        )}
        {post.externalUrl && (
          <a href={post.externalUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors w-fit">
            <ExternalLink className="w-3.5 h-3.5" /> View live post
          </a>
        )}
      </div>
    </div>
  );
}

function AdDetailPanel({ ad, onClose }: { ad: AdCampaign; onClose: () => void }) {
  const accent = ad.platform === "meta" || ad.platform === "facebook" ? "#1877F2" : "#4285F4";
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
          <span className="text-sm font-semibold capitalize">{ad.platform} Ad</span>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border capitalize"
            style={{ color: STATUS_DOT[ad.status] || "#9ca3af", borderColor: (STATUS_DOT[ad.status] || "#9ca3af") + "50", background: (STATUS_DOT[ad.status] || "#9ca3af") + "12" }}
          >
            {ad.status}
          </span>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 font-medium">Campaign</p>
          <p className="text-base font-semibold">{ad.name}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: "Start", value: ad.startDate ? formatDate(ad.startDate) : "—" },
            { label: "End",   value: ad.endDate   ? formatDate(ad.endDate)   : "Ongoing" },
            { label: "Budget", value: ad.dailyBudgetCents ? `$${(ad.dailyBudgetCents / 100).toFixed(0)}/day` : "—" },
            { label: "Platform", value: ad.platform ? ad.platform.charAt(0).toUpperCase() + ad.platform.slice(1) : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-muted/40 px-3 py-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className="text-[13px] font-medium mt-0.5">{value}</p>
            </div>
          ))}
        </div>
        {ad.creative?.imageUrl && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-medium">Creative</p>
            <img src={ad.creative.imageUrl} alt="" className="w-full rounded-xl object-cover max-h-40 border border-border/40" />
            {ad.creative.headline && <p className="mt-2 text-[13px] font-semibold">{ad.creative.headline}</p>}
            {ad.creative.primaryText && <p className="mt-1 text-[12px] text-muted-foreground">{ad.creative.primaryText}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Calendar Event Chip ──────────────────────────────────────────────────────

function EventChip({ item, onClick, isSelected, compact }: { item: CalendarItem; onClick: () => void; isSelected: boolean; compact?: boolean }) {
  if (item.kind === "post") {
    const p = item.post;
    const accent = CHANNEL_ACCENT[p.channel] || "#6366f1";
    const bg = CHANNEL_BG[p.channel] || "rgba(99,102,241,0.08)";
    const statusDot = STATUS_DOT[p.status] || "#9ca3af";
    const time = p.publishedAt || p.scheduledAt;
    return (
      <button
        onClick={onClick}
        className="w-full text-left rounded-lg overflow-hidden transition-all duration-150 hover:brightness-95 active:scale-[0.98]"
        style={{ background: isSelected ? accent + "20" : bg, borderLeft: `3px solid ${accent}`, outline: isSelected ? `1.5px solid ${accent}` : "none" }}
      >
        <div className={compact ? "px-1.5 py-1" : "px-2 py-1.5"}>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusDot }} />
            <span className={`${compact ? "text-[10px]" : "text-[11px]"} font-semibold leading-tight truncate`} style={{ color: accent }}>
              {CHANNEL_LABEL[p.channel] || p.channel}
            </span>
            {time && !compact && (
              <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 ml-auto">{formatTime(time)}</span>
            )}
          </div>
          {!compact && (
            <p className="text-[11px] text-foreground/70 leading-snug mt-0.5 line-clamp-2">
              {p.content.slice(0, 60)}{p.content.length > 60 ? "..." : ""}
            </p>
          )}
          {compact && (
            <p className="text-[10px] text-foreground/55 truncate leading-tight mt-0.5">
              {p.content.slice(0, 30)}{p.content.length > 30 ? "..." : ""}
            </p>
          )}
        </div>
      </button>
    );
  }

  const adAccent = item.ad.platform === "meta" || item.ad.platform === "facebook" ? "#1877F2" : "#4285F4";
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg overflow-hidden transition-all duration-150 hover:brightness-95 active:scale-[0.98]"
      style={{ background: isSelected ? adAccent + "20" : adAccent + "10", borderLeft: `3px solid ${adAccent}`, outline: isSelected ? `1.5px solid ${adAccent}` : "none" }}
    >
      <div className={compact ? "px-1.5 py-1" : "px-2 py-1.5"}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`${compact ? "text-[10px]" : "text-[11px]"} font-semibold leading-tight`} style={{ color: adAccent }}>Ad</span>
          <span className={`${compact ? "text-[10px]" : "text-[11px]"} text-foreground/55 truncate leading-tight flex-1 min-w-0`}>{item.ad.name}</span>
        </div>
      </div>
    </button>
  );
}

// ─── Mobile Agenda View ──────────────────────────────────────────────────────

function MobileAgendaDay({ date, items, selected, onSelect }: { date: Date; items: CalendarItem[]; selected: CalendarItem | null; onSelect: (item: CalendarItem | null) => void }) {
  const todayStr = isoDate(new Date());
  const dateStr = isoDate(date);
  const isToday = dateStr === todayStr;

  return (
    <div className={`rounded-xl border border-border/30 p-3 ${isToday ? "bg-primary/[0.03] border-primary/20" : "bg-card"}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-sm font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>
          {date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
        </span>
        {isToday && <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Today</span>}
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => {
          const isItemSelected = selected !== null && selected.kind === item.kind &&
            (item.kind === "post" ? selected.kind === "post" && selected.post.id === item.post.id : selected.kind === "ad" && selected.ad.id === item.ad.id);
          return <EventChip key={i} item={item} isSelected={isItemSelected} onClick={() => onSelect(isItemSelected ? null : item)} />;
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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

  // Build date → items map
  const itemsByDate = new Map<string, CalendarItem[]>();
  for (const post of posts) {
    const date = getDateForPost(post);
    if (!date) continue;
    const list = itemsByDate.get(date) || [];
    list.push({ kind: "post", date, post });
    itemsByDate.set(date, list);
  }
  for (const ad of ads) {
    if (!ad.startDate) continue;
    const date = isoDate(new Date(ad.startDate));
    const list = itemsByDate.get(date) || [];
    list.push({ kind: "ad", date, ad });
    itemsByDate.set(date, list);
  }

  const days = calendarDays(year, month);
  const todayStr = isoDate(today);

  const prevMonth = () => month === 0 ? (setMonth(11), setYear(y => y - 1)) : setMonth(m => m - 1);
  const nextMonth = () => month === 11 ? (setMonth(0), setYear(y => y + 1)) : setMonth(m => m + 1);

  return (
    <AppShell>
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .detail-panel { animation: slideInRight 0.18s ease-out; }
      `}</style>

      {/* Build mobile agenda data */}
      {(() => {
        const agendaDays: { date: Date; items: CalendarItem[] }[] = [];
        for (const day of days) {
          if (!day) continue;
          const dateStr = isoDate(day);
          const items = itemsByDate.get(dateStr);
          if (items && items.length > 0) agendaDays.push({ date: day, items });
        }

        return (
          <div className="flex flex-col lg:flex-row gap-6 h-full">

            {/* ── Calendar column ── */}
            <div className="flex flex-col min-w-0 flex-1">
              {/* Header row */}
              <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
                  {MONTH_NAMES[month]}{" "}
                  <span className="text-muted-foreground font-normal">{year}</span>
                </h1>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost" size="sm"
                    className="text-xs h-8 px-3 text-muted-foreground hover:text-foreground rounded-lg"
                    onClick={() => { setMonth(today.getMonth()); setYear(today.getFullYear()); setSelected(null); }}
                  >
                    Today
                  </Button>
                  <div className="flex border border-border/50 rounded-lg overflow-hidden">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border-r border-border/50 hover:bg-muted" onClick={prevMonth}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none hover:bg-muted" onClick={nextMonth}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 sm:gap-5 mb-4 flex-wrap">
                {[
                  { label: "Published", color: STATUS_DOT.published },
                  { label: "Scheduled", color: STATUS_DOT.scheduled },
                  { label: "Failed",    color: STATUS_DOT.failed },
                ].map(({ label, color }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                  </div>
                ))}
                <div className="w-px h-3 bg-border/50 hidden sm:block" />
                {Object.entries(CHANNEL_LABEL).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <span className="w-0.5 h-3 rounded-full" style={{ background: CHANNEL_ACCENT[key] }} />
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>

              {/* Grid — desktop */}
              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="h-5 w-5 border-2 border-foreground/15 border-t-foreground rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {/* Desktop calendar grid */}
                  <div className="hidden md:flex flex-1 flex-col rounded-xl border border-border/40 overflow-hidden bg-card">
                    {/* Day-of-week row */}
                    <div className="grid grid-cols-7 border-b border-border/40 bg-muted/20">
                      {DAY_NAMES.map((d) => (
                        <div key={d} className="py-2.5 text-center text-xs font-medium text-muted-foreground/70 tracking-wider">
                          {d}
                        </div>
                      ))}
                    </div>

                    {/* Day cells — fill remaining height */}
                    <div className="grid grid-cols-7 flex-1" style={{ gridAutoRows: "1fr" }}>
                      {days.map((day, idx) => {
                        if (!day) {
                          return <div key={`pad-${idx}`} className="border-b border-r border-border/25 bg-muted/10" />;
                        }

                        const dateStr = isoDate(day);
                        const isToday = dateStr === todayStr;
                        const items = itemsByDate.get(dateStr) || [];
                        const MAX = 2;
                        const overflow = Math.max(0, items.length - MAX);

                        return (
                          <div
                            key={dateStr}
                            className={`border-b border-r border-border/25 p-1.5 flex flex-col gap-1 transition-colors overflow-hidden ${
                              isToday ? "bg-primary/[0.03]" : "bg-background hover:bg-muted/10"
                            }`}
                          >
                            {/* Date number */}
                            <div className="flex justify-end px-0.5">
                              <span
                                className={`text-xs w-6 h-6 flex items-center justify-center rounded-full font-medium leading-none ${
                                  isToday ? "bg-foreground text-background" : "text-muted-foreground/60"
                                }`}
                              >
                                {day.getDate()}
                              </span>
                            </div>

                            {/* Event chips */}
                            <div className="flex-1 flex flex-col gap-1 min-h-0 overflow-hidden">
                              {items.slice(0, MAX).map((item, i) => {
                                const isItemSelected =
                                  selected !== null &&
                                  selected.kind === item.kind &&
                                  (item.kind === "post"
                                    ? selected.kind === "post" && selected.post.id === item.post.id
                                    : selected.kind === "ad" && selected.ad.id === item.ad.id);
                                return (
                                  <EventChip
                                    key={i}
                                    item={item}
                                    isSelected={isItemSelected}
                                    onClick={() => setSelected(isItemSelected ? null : item)}
                                  />
                                );
                              })}
                              {overflow > 0 && (
                                <button
                                  className="text-[10px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors pl-2 text-left"
                                  onClick={() => setSelected(items[MAX])}
                                >
                                  +{overflow} more
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Mobile agenda view */}
                  <div className="md:hidden space-y-3">
                    {agendaDays.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-sm text-muted-foreground">No posts this month.</p>
                      </div>
                    ) : (
                      agendaDays.map(({ date, items }) => (
                        <MobileAgendaDay
                          key={isoDate(date)}
                          date={date}
                          items={items}
                          selected={selected}
                          onSelect={setSelected}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ── Detail panel ── */}
            {selected && (
              <div className="detail-panel shrink-0 rounded-xl border border-border/40 bg-card overflow-hidden w-full lg:w-[380px]">
                {selected.kind === "post" && (
                  <PostDetailPanel post={selected.post} onClose={() => setSelected(null)} />
                )}
                {selected.kind === "ad" && (
                  <AdDetailPanel ad={selected.ad} onClose={() => setSelected(null)} />
                )}
              </div>
            )}
          </div>
        );
      })()}
    </AppShell>
  );
}
