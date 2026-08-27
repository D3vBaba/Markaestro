"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, X, Plus } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { toast } from "sonner";
import Link from "next/link";

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
  /** Brands are stored as `products` in Firestore; posts link via productId. */
  productId?: string;
};

/** A brand, as returned by /api/products (the storage name for brands). */
type Brand = {
  id: string;
  name: string;
  brandIdentity?: { logoUrl?: string; primaryColor?: string };
};

type CalendarItem = { kind: "post"; date: string; post: Post };

// ─── Constants ────────────────────────────────────────────────────────────────

// Channel names are platform brand names (Instagram, TikTok, ...) — proper
// nouns that stay in English across every locale, same as elsewhere in the app.
const CHANNEL_ACCENT: Record<string, string> = {
  instagram: "#E4405F",
  facebook:  "#1877F2",
  tiktok:    "#00F2FE",
  threads:   "#000000",
  pinterest: "#E60023",
  linkedin:  "#0A66C2",
};

const CHANNEL_BG: Record<string, string> = {
  instagram: "color-mix(in srgb, #E4405F 10%, transparent)",
  facebook:  "color-mix(in srgb, #1877F2 10%, transparent)",
  tiktok:    "color-mix(in srgb, #00F2FE 10%, transparent)",
  threads:   "color-mix(in srgb, #000000 10%, transparent)",
  pinterest: "color-mix(in srgb, #E60023 10%, transparent)",
  linkedin:  "color-mix(in srgb, #0A66C2 10%, transparent)",
};

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook:  "Facebook",
  tiktok:    "TikTok",
  threads:   "Threads",
  pinterest: "Pinterest",
  linkedin:  "LinkedIn",
};

/** Sentinel brand filter value matching posts that have no brand linked. */
const UNASSIGNED_BRAND = "none";

const STATUS_DOT: Record<string, string> = {
  published:  "#10b981",
  scheduled:  "#2563eb",
  draft:      "#94a3b8",
  failed:     "#f43f5e",
  partial_failed: "#f59e0b",
  publishing: "#f59e0b",
};



// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateForPost(p: Post): string | null {
  if (p.publishedAt) return isoDate(new Date(p.publishedAt));
  if (p.scheduledAt) return isoDate(new Date(p.scheduledAt));
  return null;
}

/** Sort key for ordering a day's posts chronologically. */
function getTimeForPost(p: Post): number {
  const when = p.publishedAt || p.scheduledAt;
  return when ? new Date(when).getTime() : 0;
}

/** Parse an ISO `YYYY-MM-DD` as a local-midnight Date (avoids UTC drift). */
function parseIsoDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
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

function formatTime(iso: string, locale: string) {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url);
}

// ─── Platform Mockups ─────────────────────────────────────────────────────────

function InstagramMockup({ post }: { post: Post }) {
  const t = useTranslations("calendar.mockups");
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
            <p className="text-[12px] font-semibold leading-none text-zinc-900 dark:text-white">yourbrand</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">{t("sponsored")}</p>
          </div>
        </div>
        <span className="text-zinc-400 text-lg leading-none">···</span>
      </div>
      {img ? (
        isVideoUrl(img)
          ? <video src={img} className="w-full aspect-square object-cover" controls playsInline preload="metadata" />
          : <img src={img} alt="" className="w-full aspect-square object-cover" />
      ) : (
        <div className="w-full aspect-square flex items-center justify-center bg-slate-100 dark:bg-slate-800">
          <svg className="w-10 h-10 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
          </svg>
        </div>

      )}
      <div className="px-3 pt-2.5 pb-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-3">
            <span>{t("like")}</span>
            <span>{t("comment")}</span>
            <span>{t("share")}</span>
          </div>
          <span>{t("save")}</span>
        </div>
        <p className="text-[12px] text-zinc-900 dark:text-white leading-snug">
          <span className="font-semibold">yourbrand </span>
          {post.content.length > 120 ? post.content.slice(0, 120) + "…" : post.content}
        </p>
      </div>
    </div>
  );
}

function FacebookMockup({ post }: { post: Post }) {
  const t = useTranslations("calendar.mockups");
  const img = post.mediaUrls?.[0];
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#242526] shadow-md max-w-[320px] mx-auto overflow-hidden">
      <div className="flex items-start justify-between p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-[#1877F2] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-xl leading-none">f</span>
          </div>
          <div>
            <p className="text-[13px] font-semibold leading-none text-zinc-900 dark:text-[#e4e6ea]">Your Brand</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">{t("justNow")} · 🌐</p>
          </div>
        </div>
      </div>
      <p className="px-3 pb-2 text-[13px] leading-snug text-zinc-900 dark:text-[#e4e6ea] whitespace-pre-wrap">
        {post.content.length > 200 ? post.content.slice(0, 200) + "…" : post.content}
      </p>
      {img && !isVideoUrl(img) && <img src={img} alt="" className="w-full object-cover max-h-48" />}
      <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-700/50">
        <div className="flex items-center justify-around pt-1">
          {[t("likeAction"), t("commentAction"), t("shareAction")].map((l) => (
            <button key={l} className="flex-1 text-center text-[12px] font-medium text-zinc-500 py-1 rounded-lg">{l}</button>
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
        <div className="absolute bottom-0 left-0 right-7 p-2.5">
          <p className="text-[9px] font-bold text-white mb-0.5">@yourbrand</p>
          <p className="text-[8px] text-white/80 leading-tight line-clamp-3">{post.content}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Panels ────────────────────────────────────────────────────────────

function PostDetailPanel({ post, onClose, onBack, brandName }: {
  post: Post;
  onClose: () => void;
  /** Present when the post was opened from a day list — returns to that list. */
  onBack?: () => void;
  brandName?: string;
}) {
  const t = useTranslations("calendar.detailPanel");
  const tStatus = useTranslations("calendar.statusLabels");
  const locale = useLocale();
  const accent = CHANNEL_ACCENT[post.channel] || "#2563eb";

  const statusDate = post.publishedAt || post.scheduledAt;
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              aria-label={t("backToDay")}
              className="w-9 h-9 lg:w-7 lg:h-7 -ms-1.5 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: accent }} />
          <span className="text-sm font-semibold">{CHANNEL_LABEL[post.channel] || post.channel}</span>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border capitalize"
            style={{ color: STATUS_DOT[post.status], borderColor: STATUS_DOT[post.status] + "50", background: STATUS_DOT[post.status] + "12" }}
          >
            {tStatus.has(post.status) ? tStatus(post.status) : post.status}
          </span>
        </div>
        <button onClick={onClose} aria-label={t("close")} className="w-9 h-9 lg:w-7 lg:h-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {(statusDate || brandName) && (
          <p className="text-[11px] text-muted-foreground">
            {statusDate && (
              <>
                {post.status === "published" ? t("published") : t("scheduled")} · {formatDate(statusDate, locale)} {formatTime(statusDate, locale)}
              </>
            )}
            {statusDate && brandName && " · "}
            {brandName}
          </p>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3 font-medium">{t("preview")}</p>
          {post.channel === "instagram" && <InstagramMockup post={post} />}
          {post.channel === "facebook" && <FacebookMockup post={post} />}
          {post.channel === "tiktok" && <TikTokMockup post={post} />}
          {!["instagram","facebook","tiktok"].includes(post.channel) && (
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
            </div>
          )}
        </div>
        {post.errorMessage && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-[12px] text-destructive">
            {t("failedToPublish")}
          </div>
        )}
        {post.externalUrl && (
          <a href={post.externalUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors w-fit">
            {t("viewLivePost")}
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Visual Event Chip with Media Thumbnail ──────────────────────────────────

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  instagram: (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
  ),
  facebook: (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
  ),
  tiktok: (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.51a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.75a8.18 8.18 0 0 0 4.76 1.52V6.84a4.84 4.84 0 0 1-1-.15z"/></svg>
  ),
};

function VisualEventChip({ item, onClick, isSelected, onDragStart, showDetail = false }: {
  item: CalendarItem;
  onClick: () => void;
  isSelected: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** Agenda rows render time + caption snippet so they're informative without opening the panel. */
  showDetail?: boolean;
}) {
  const t = useTranslations("calendar.detailPanel");
  const locale = useLocale();
  const p = item.post;
  const accent = CHANNEL_ACCENT[p.channel] || "#2563eb";
  const bg = CHANNEL_BG[p.channel] || "rgba(37,99,235,0.08)";

  const thumb = p.mediaUrls?.[0];
  const draggable = p.status === "scheduled" || p.status === "draft";

  const isFailed = p.status === "failed" || p.status === "partial_failed";
  const when = p.publishedAt || p.scheduledAt;

  return (
    <button
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      title={isFailed ? t("failedToPublish") : undefined}
      className="w-full rounded-lg overflow-hidden transition-[filter,transform] duration-150 hover:brightness-95 active:scale-[0.98] cursor-grab active:cursor-grabbing"
      style={{ background: isSelected ? accent + "20" : bg, borderLeft: `3px solid ${accent}`, outline: isSelected ? `1.5px solid ${accent}` : "none" }}
    >
      <div className={`px-1.5 flex items-center gap-1.5 ${showDetail ? "py-2 min-h-[44px]" : "py-1"}`}>
        {/* Media thumbnail */}
        {thumb && !isVideoUrl(thumb) ? (
          <img src={thumb} alt="" className={`rounded object-cover shrink-0 ${showDetail ? "w-8 h-8" : "w-6 h-6"}`} draggable={false} />
        ) : (
          <div className={`rounded shrink-0 flex items-center justify-center ${showDetail ? "w-8 h-8" : "w-6 h-6"}`} style={{ background: accent + "18" }}>
            <div style={{ color: accent }}>{CHANNEL_ICON[p.channel] || null}</div>
          </div>
        )}
        {/* Platform icon */}
        <div style={{ color: accent }} className="shrink-0">
          {CHANNEL_ICON[p.channel] || null}
        </div>
        {showDetail && (
          <span className="flex-1 min-w-0 text-start text-[12px] truncate text-foreground/80">
            {p.content || t("untitledPost")}
          </span>
        )}
        {showDetail && when && (
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            {formatTime(when, locale)}
          </span>
        )}
        {/* Failed indicator — surfaces errors without opening the detail panel */}
        {isFailed && (
          <span className="ms-auto shrink-0 flex items-center" style={{ color: "var(--mk-neg)" }} aria-label={t("failedToPublish")}>
            <AlertCircle className="w-3 h-3" />
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Day Posts Panel ─────────────────────────────────────────────────────────
// A month cell only has room for a few chips. This lists every post on a single
// day so busy days stay fully reviewable.

function DayPostsPanel({ dateStr, items, onSelect, onClose, onDragStart }: {
  dateStr: string;
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
  onClose: () => void;
  /** Lets rows be dragged onto the grid to reschedule, same as cell chips. */
  onDragStart: (post: Post) => (e: React.DragEvent) => void;
}) {
  const t = useTranslations("calendar.dayPanel");
  const locale = useLocale();
  const date = parseIsoDate(dateStr);
  const isToday = dateStr === isoDate(new Date());

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold m-0 truncate">
              {date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })}
            </p>
            {isToday && (
              <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0">{t("today")}</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 m-0">
            {t("postCount", { count: items.length })}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="w-9 h-9 lg:w-7 lg:h-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
        {items.length === 0 ? (
          <p className="text-[12px] text-muted-foreground text-center py-8 m-0">
            {t("noPosts")}
          </p>
        ) : (
          items.map((item) => (
            <VisualEventChip
              key={item.post.id}
              item={item}
              isSelected={false}
              showDetail
              onClick={() => onSelect(item)}
              onDragStart={onDragStart(item.post)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Mobile Agenda View ──────────────────────────────────────────────────────

function MobileAgendaDay({ date, items, selected, onSelect }: {
  date: Date;
  items: CalendarItem[];
  selected: CalendarItem | null;
  onSelect: (item: CalendarItem | null) => void;
}) {
  const t = useTranslations("calendar.agenda");
  const locale = useLocale();
  const todayStr = isoDate(new Date());
  const dateStr = isoDate(date);
  const isToday = dateStr === todayStr;

  return (
    <div className={`rounded-xl border border-border/30 p-3 ${isToday ? "bg-primary/[0.03] border-primary/20" : "bg-card"}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-sm font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>
          {date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}
        </span>
        {isToday && <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">{t("today")}</span>}
        <span className="text-[10px] text-muted-foreground ms-auto">{t("itemCount", { count: items.length })}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => {
          const isItemSelected = selected !== null && selected.post.id === item.post.id;
          return <VisualEventChip key={i} item={item} isSelected={isItemSelected} showDetail onClick={() => onSelect(isItemSelected ? null : item)} />;
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function CalendarPageContent() {
  const t = useTranslations("calendar");
  const tStatus = useTranslations("calendar.statusLabels");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  // Locale-aware month name and Sun-first weekday abbreviations. Jan 1 2023 was
  // a Sunday, used purely as an anchor date to walk the week in order.
  const monthLabel = new Date(year, month, 1).toLocaleDateString(locale, { month: "long" });
  const dayNames = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(locale, { weekday: "short" })),
    [locale],
  );
  // Fetch the month being viewed rather than "the N most recent posts". The
  // API orders by createdAt, which has nothing to do with the day a post lands
  // on, so a recency window silently drops posts the grid needs to draw.
  // Bounds are local midnight to local midnight because the grid renders local
  // days, and the API compares them against UTC instants.
  const monthWindow = useMemo(() => {
    const params = new URLSearchParams({
      from: new Date(year, month, 1).toISOString(),
      to: new Date(year, month + 1, 1).toISOString(),
    });
    return `/api/posts?${params.toString()}`;
  }, [year, month]);
  const {
    data: postsData,
    loading,
    error: loadError,
    refresh,
  } = useApiQuery<{ posts: Post[]; truncated?: boolean }>(monthWindow);
  // Same query key as the Brands page, so this usually hits a warm cache.
  const { data: brandsData } = useApiQuery<{ products: Brand[] }>("/api/products");
  const brands = useMemo(() => brandsData?.products ?? [], [brandsData]);
  const brandsById = useMemo(
    () => new Map(brands.map((b) => [b.id, b])),
    [brands]
  );
  // Optimistic patches (postId → patched fields) layered over query data so
  // drag-to-reschedule feels instant; cleared once fresh data arrives.
  const [overrides, setOverrides] = useState<Record<string, Partial<Post>>>({});
  const posts = useMemo(() => {
    const base = postsData?.posts ?? [];
    return base.map((p) => (overrides[p.id] ? { ...p, ...overrides[p.id] } : p));
  }, [postsData, overrides]);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  // ISO date whose full post list is open in the side rail. Kept set while a
  // post from that day is previewed so "back" returns to the list.
  const [dayView, setDayView] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<Post | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Filters initialize from URL (?status=…&channel=…&brand=…) so dashboard
  // drill-ins and shared links work
  const [statusFilter, setStatusFilter] = useState<string | null>(
    () => searchParams.get("status")
  );
  const [channelFilter, setChannelFilter] = useState<string | null>(
    () => searchParams.get("channel")
  );
  // A brand id, or UNASSIGNED_BRAND for posts with no brand linked.
  const [brandFilter, setBrandFilter] = useState<string | null>(
    () => searchParams.get("brand")
  );

  // Keep state in sync with the URL (e.g. back/forward navigation). Adjusted
  // during render so a history move paints the right filters in one pass.
  const urlFilterKey = `${searchParams.get("status") ?? ""}|${searchParams.get("channel") ?? ""}|${searchParams.get("brand") ?? ""}`;
  const [syncedFilterKey, setSyncedFilterKey] = useState(urlFilterKey);
  if (urlFilterKey !== syncedFilterKey) {
    setSyncedFilterKey(urlFilterKey);
    setStatusFilter(searchParams.get("status"));
    setChannelFilter(searchParams.get("channel"));
    setBrandFilter(searchParams.get("brand"));
  }

  // ── Deep-link to a single post (?post=<id>) ──────────────────────────
  // The dashboard's "Recent posts" widget links here. Open the post's
  // preview panel and jump to its month; if it's already been deleted,
  // show a friendly notice instead of a dead end.
  const [deletedNotice, setDeletedNotice] = useState(false);
  const handledFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const focusId = searchParams.get("post");
    if (!focusId) return;
    // Wait for the first page of posts before deciding "not found".
    if (loading && !postsData) return;
    if (handledFocusRef.current === focusId) return;
    handledFocusRef.current = focusId;

    const clearParam = () => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("post");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };

    const focusOn = (post: Post) => {
      const when = post.publishedAt || post.scheduledAt;
      if (when) {
        const d = new Date(when);
        setYear(d.getFullYear());
        setMonth(d.getMonth());
      }
      setDeletedNotice(false);
      setDayView(null);
      setSelected({ kind: "post", date: getDateForPost(post) ?? "", post });
    };

    // Fast path: the post is already in the loaded window.
    const existing = posts.find((p) => p.id === focusId);
    if (existing) {
      focusOn(existing);
      clearParam();
      return;
    }

    // Otherwise ask the API definitively — the post may simply be outside
    // the loaded window, or it may have been deleted.
    let cancelled = false;
    (async () => {
      const res = await apiGet<Post>(`/api/posts/${focusId}`);
      if (cancelled) return;
      if (res.ok) {
        focusOn(res.data);
      } else if (res.status === 404) {
        setDeletedNotice(true);
      } else {
        toast.error(t("postNotFoundToast"));
      }
      clearParam();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, postsData, posts, pathname, router]);

  // Patch one or more filters at once; omitted keys keep their current value.
  // Each filter mirrors into the URL so views stay shareable.
  const applyFilters = useCallback(
    (patch: { status?: string | null; channel?: string | null; brand?: string | null }) => {
      const next = {
        status: "status" in patch ? patch.status ?? null : statusFilter,
        channel: "channel" in patch ? patch.channel ?? null : channelFilter,
        brand: "brand" in patch ? patch.brand ?? null : brandFilter,
      };
      setStatusFilter(next.status);
      setChannelFilter(next.channel);
      setBrandFilter(next.brand);

      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, statusFilter, channelFilter, brandFilter]
  );

  // Brand select options beyond the loaded brands: a "No brand" bucket when any
  // post lacks one, and a placeholder when ?brand= names a brand we can't resolve.
  const hasUnassignedPosts = posts.some((p) => !p.productId);
  const unknownBrandId =
    brandFilter && brandFilter !== UNASSIGNED_BRAND && !brandsById.has(brandFilter)
      ? brandFilter
      : null;

  const hasActiveFilters = Boolean(statusFilter || channelFilter || brandFilter);
  const clearFilters = () => applyFilters({ status: null, channel: null, brand: null });

  const clearOverride = useCallback((postId: string) => {
    setOverrides((prev) => {
      if (!(postId in prev)) return prev;
      const next = { ...prev };
      delete next[postId];
      return next;
    });
  }, []);

  // ─── Drag & Drop handlers ────────────────────────────────────────────
  const handleDragStart = (post: Post) => (e: React.DragEvent) => {
    setDragItem(post);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", post.id);
  };

  const handleDragOver = (dateStr: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(dateStr);
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (dateStr: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    if (!dragItem) return;
    const post = dragItem;
    setDragItem(null);

    // Preserve original time, just change the date
    const originalDate = post.scheduledAt ? new Date(post.scheduledAt) : new Date();
    const [y, m, d] = dateStr.split("-").map(Number);
    const newDate = new Date(originalDate);
    newDate.setFullYear(y, m - 1, d);

    // Optimistically move the chip; revert by clearing the override on failure
    setOverrides((prev) => ({
      ...prev,
      [post.id]: { scheduledAt: newDate.toISOString(), status: "scheduled" },
    }));

    try {
      const res = await apiPut(`/api/posts/${post.id}`, {
        scheduledAt: newDate.toISOString(),
        status: "scheduled",
      });
      if (res.ok) {
        toast.success(t("postMovedToast", { date: new Date(dateStr).toLocaleDateString(locale, { month: "short", day: "numeric" }) }));
        // Drop every cached /api/posts query, then await our own refetch so
        // the override is only cleared once fresh data is in place.
        invalidateQueries("/api/posts");
        await refresh();
        clearOverride(post.id);
      } else {
        clearOverride(post.id);
        toast.error(t("rescheduleFailedToast"));
      }
    } catch {
      clearOverride(post.id);
      toast.error(t("rescheduleFailedToast"));
    }
  };

  // Build date → items map (with filters applied)
  const filteredPosts = posts.filter((p) =>
    (!statusFilter || p.status === statusFilter) &&
    (!channelFilter || p.channel === channelFilter) &&
    (!brandFilter ||
      (brandFilter === UNASSIGNED_BRAND ? !p.productId : p.productId === brandFilter))
  );
  const itemsByDate = new Map<string, CalendarItem[]>();
  for (const post of filteredPosts) {
    const date = getDateForPost(post);
    if (!date) continue;
    const list = itemsByDate.get(date) || [];
    list.push({ kind: "post", date, post });
    itemsByDate.set(date, list);
  }
  // Chronological within a day, so the cell's visible chips are the earliest
  // ones and the day list reads top-to-bottom in posting order.
  for (const list of itemsByDate.values()) {
    list.sort((a, b) => getTimeForPost(a.post) - getTimeForPost(b.post));
  }

  const days = calendarDays(year, month);
  const todayStr = isoDate(today);

  // ─── Side rail: day list ⇄ single-post preview ───────────────────────
  const openDay = (dateStr: string) => {
    setSelected(null);
    setDayView(dateStr);
  };
  const openPost = (item: CalendarItem, fromDayList: boolean) => {
    if (!fromDayList) setDayView(null);
    setSelected(item);
  };
  const closeRail = () => {
    setSelected(null);
    setDayView(null);
  };
  const railOpen = Boolean(selected || dayView);

  // Rendered twice (desktop sidebar + mobile sheet) — only one is ever visible.
  const renderRail = () => {
    if (selected) {
      return (
        <PostDetailPanel
          post={selected.post}
          onClose={closeRail}
          onBack={dayView ? () => setSelected(null) : undefined}
          brandName={selected.post.productId ? brandsById.get(selected.post.productId)?.name : undefined}
        />
      );
    }
    if (dayView) {
      return (
        <DayPostsPanel
          dateStr={dayView}
          items={itemsByDate.get(dayView) ?? []}
          onSelect={(item) => openPost(item, true)}
          onClose={closeRail}
          onDragStart={handleDragStart}
        />
      );
    }
    return null;
  };

  // Escape steps back through the rail: post → day list → closed.
  useEffect(() => {
    if (!railOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // From a post opened out of a day list, step back to the list first.
      if (selected && dayView) setSelected(null);
      else { setSelected(null); setDayView(null); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [railOpen, selected, dayView]);

  const prevMonth = () => month === 0 ? (setMonth(11), setYear(y => y - 1)) : setMonth(m => m - 1);
  const nextMonth = () => month === 11 ? (setMonth(0), setYear(y => y + 1)) : setMonth(m => m + 1);

  // Build mobile agenda
  const agendaDays: { date: Date; items: CalendarItem[] }[] = [];
  for (const day of days) {
    if (!day) continue;
    const dateStr = isoDate(day);
    const items = itemsByDate.get(dateStr);
    if (items && items.length > 0) agendaDays.push({ date: day, items });
  }

  // Count totals for month (respects active filter)
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const totalPosts = filteredPosts.filter(p => {
    const d = getDateForPost(p);
    return d && d.startsWith(monthPrefix);
  }).length;

  return (
    <>
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .detail-panel { animation: slideInRight 0.18s ease-out; }
        .drop-highlight { background: rgba(var(--primary-rgb, 0, 102, 255), 0.06) !important; outline: 2px dashed rgba(var(--primary-rgb, 0, 102, 255), 0.3); outline-offset: -2px; }
      `}</style>

      <div className="flex flex-col lg:flex-row gap-6 h-full">
        {/* ── Calendar column ── */}
        <div className="flex flex-col min-w-0 flex-1">
          {/* Deleted-post notice — shown when a deep link points at a post
              that no longer exists (e.g. an old "Recent posts" link) */}
          {deletedNotice && (
            <div
              className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4"
              style={{ background: "var(--mk-surface)", border: "1px dashed var(--mk-rule)" }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertCircle className="h-4 w-4 shrink-0" style={{ color: "var(--mk-ink-40)" }} />
                <p className="text-[13px] m-0" style={{ color: "var(--mk-ink-60)" }}>
                  {t("deletedNotice")}
                </p>
              </div>
              <button
                onClick={() => setDeletedNotice(false)}
                aria-label={t("dismiss")}
                className="shrink-0 w-7 h-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Safety-ceiling notice — the month held more posts than one read
              returns, so the grid below is incomplete. Should not happen in
              practice; shown rather than silently dropping posts. */}
          {postsData?.truncated && (
            <div
              className="flex items-center gap-2.5 rounded-lg px-4 py-3 mb-4"
              style={{ background: "var(--mk-surface)", border: "1px dashed var(--mk-warn)" }}
            >
              <AlertCircle className="h-4 w-4 shrink-0" style={{ color: "var(--mk-warn)" }} />
              <p className="text-[13px] m-0" style={{ color: "var(--mk-ink-60)" }}>
                {t("truncatedNotice")}
              </p>
            </div>
          )}

          {/* Header row */}
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 capitalize">
                {monthLabel}{" "}
                <span className="font-light text-slate-400 dark:text-slate-500">
                  {year}
                </span>
              </h1>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 mt-1">
                {t("postsThisMonth", { count: totalPosts })}
                {dragItem && (
                  <span className="ms-2 font-bold text-blue-600 dark:text-blue-400">
                    {t("dropToReschedule")}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/content">
                <Button className="h-9 px-3.5 rounded-xl gap-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs">
                  <Plus className="h-4 w-4" /> {t("newPost")}
                </Button>
              </Link>

              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3.5 rounded-xl text-xs font-semibold border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800"
                disabled={month === today.getMonth() && year === today.getFullYear()}
                onClick={() => { setMonth(today.getMonth()); setYear(today.getFullYear()); closeRail(); }}
              >
                {t("today")}
              </Button>
              <div className="flex rounded-xl overflow-hidden border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-none border-r border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={prevMonth}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-none hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={nextMonth}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>


          {/* Filters + Legend */}
          <div className="flex items-center gap-2 sm:gap-3 mb-4 flex-nowrap overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible">
            {[
              { key: "published", color: STATUS_DOT.published },
              { key: "scheduled", color: STATUS_DOT.scheduled },
              { key: "failed", color: STATUS_DOT.failed },
              { key: "partial_failed", color: STATUS_DOT.partial_failed },
            ].map(({ key, color }) => {
              const active = statusFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => applyFilters({ status: active ? null : key })}
                  className={`flex items-center gap-1.5 px-3 sm:px-2.5 py-2 sm:py-1 shrink-0 whitespace-nowrap rounded-full border text-[11px] font-medium transition-colors ${
                    active
                      ? "border-current bg-current/10"
                      : "border-transparent hover:bg-muted"
                  }`}
                  style={active ? { color, borderColor: color + "60" } : undefined}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className={active ? "" : "text-muted-foreground"}>{tStatus(key)}</span>
                </button>
              );
            })}
            <div className="w-px h-3 bg-border/50 hidden sm:block" />
            {Object.entries(CHANNEL_LABEL).map(([key, label]) => {
              const active = channelFilter === key;
              const color = CHANNEL_ACCENT[key];
              return (
                <button
                  key={key}
                  onClick={() => applyFilters({ channel: active ? null : key })}
                  className={`flex items-center gap-1.5 px-3 sm:px-2.5 py-2 sm:py-1 shrink-0 whitespace-nowrap rounded-full border text-[11px] font-medium transition-colors ${
                    active
                      ? "border-current bg-current/10"
                      : "border-transparent hover:bg-muted"
                  }`}
                  style={active ? { color, borderColor: color + "60" } : undefined}
                >
                  <span className="w-0.5 h-3 rounded-full" style={{ background: color }} />
                  <span className={active ? "" : "text-muted-foreground"}>{label}</span>
                </button>
              );
            })}
            {/* Brand filter — a select rather than chips, since a workspace can
                have many brands and the chip row is already dense. */}
            {(brands.length > 0 || brandFilter) && (
              <>
                <div className="w-px h-3 bg-border/50 hidden sm:block" />
                <label
                  className={`flex items-center gap-1.5 ps-3 sm:ps-2.5 pe-1 py-2 sm:py-1 shrink-0 whitespace-nowrap rounded-full border text-[11px] font-medium transition-colors cursor-pointer ${
                    brandFilter ? "bg-current/10" : "border-transparent hover:bg-muted"
                  }`}
                  style={
                    brandFilter
                      ? {
                          color: "var(--mk-accent)",
                          borderColor: "color-mix(in oklch, var(--mk-accent) 60%, transparent)",
                        }
                      : undefined
                  }
                >
                  <span
                    className="w-0.5 h-3 rounded-full shrink-0"
                    style={{ background: brandFilter ? "var(--mk-accent)" : "var(--mk-ink-40)" }}
                  />
                  <span className={brandFilter ? "" : "text-muted-foreground"}>{t("filters.brand")}</span>
                  <select
                    value={brandFilter ?? ""}
                    onChange={(e) => applyFilters({ brand: e.target.value || null })}
                    aria-label={t("filters.brand")}
                    className="bg-transparent border-none outline-none cursor-pointer text-[11px] font-medium max-w-36 truncate text-inherit"
                  >
                    <option value="">{t("filters.all")}</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                    {(hasUnassignedPosts || brandFilter === UNASSIGNED_BRAND) && (
                      <option value={UNASSIGNED_BRAND}>{t("filters.noBrand")}</option>
                    )}
                    {/* Keeps the control in sync when ?brand= names a brand that
                        hasn't loaded yet or has since been deleted. */}
                    {unknownBrandId && <option value={unknownBrandId}>{t("filters.unknownBrand")}</option>}
                  </select>
                </label>
              </>
            )}
            <div className="w-px h-3 bg-border/50 hidden md:block" />
            <div className="hidden md:flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">{t("filters.dragToReschedule")}</span>
            </div>
          </div>

          {/* Grid — spinner only on true initial load; post-mutation refetches
              keep the (optimistically patched) grid on screen */}
          {loading && !postsData ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="h-5 w-5 border-2 border-foreground/15 border-t-foreground rounded-full animate-spin" />
            </div>
          ) : loadError && !postsData ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12">
              <AlertCircle className="h-5 w-5" style={{ color: "var(--mk-neg)" }} />
              <p className="text-sm text-muted-foreground m-0">
                {t("loadError")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg text-[12px]"
                onClick={() => refresh()}
              >
                {t("retry")}
              </Button>
            </div>
          ) : (
            <>
              {/* Desktop empty state — acknowledges active filters */}
              {totalPosts === 0 && (
                <div
                  className="hidden md:flex items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4"
                  style={{
                    background: "var(--mk-surface)",
                    border: "1px dashed var(--mk-rule)",
                  }}
                >
                  <p className="text-sm text-muted-foreground m-0">
                    {hasActiveFilters
                      ? t("noPostsMatchingFilters")
                      : t("noPostsThisMonth")}
                  </p>
                  {hasActiveFilters ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg text-[12px]"
                      onClick={clearFilters}
                    >
                      {t("clearFilters")}
                    </Button>
                  ) : (
                    <Link href="/content">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg gap-1.5 text-[12px]"
                      >
                        <Plus className="h-3.5 w-3.5" /> {t("createPost")}
                      </Button>
                    </Link>
                  )}
                </div>
              )}

              {/* Desktop calendar grid */}
              <div
                className="hidden md:flex flex-1 flex-col rounded-xl overflow-hidden"
                style={{
                  background: "var(--mk-paper)",
                  border: "1px solid var(--mk-rule)",
                }}
              >
                <div
                  className="grid grid-cols-7 border-b"
                  style={{
                    borderColor: "var(--mk-rule)",
                    background: "var(--mk-surface)",
                  }}
                >
                  {dayNames.map((d) => (
                    <div
                      key={d}
                      className="py-2.5 text-center font-mono text-[9.5px] uppercase"
                      style={{ color: "var(--mk-ink-40)", letterSpacing: "0.18em" }}
                    >
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 flex-1" style={{ gridAutoRows: "1fr" }}>
                  {days.map((day, idx) => {
                    if (!day) {
                      return <div key={`pad-${idx}`} className="border-b border-e border-border/25 bg-muted/10" />;
                    }

                    const dateStr = isoDate(day);
                    const isToday = dateStr === todayStr;
                    const items = itemsByDate.get(dateStr) || [];
                    const MAX = 3;
                    const overflow = Math.max(0, items.length - MAX);
                    const isDropTarget = dropTarget === dateStr;
                    const isDayOpen = dayView === dateStr;

                    return (
                      <div
                        key={dateStr}
                        className={`border-b border-e border-border/25 p-1.5 flex flex-col gap-1 transition-colors overflow-hidden ${
                          isToday ? "bg-primary/[0.03]" : "bg-background hover:bg-muted/10"
                        } ${isDropTarget ? "drop-highlight" : ""} ${
                          isDayOpen ? "ring-1 ring-inset ring-primary/30" : ""
                        }`}
                        onDragOver={handleDragOver(dateStr)}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop(dateStr)}
                      >
                        <div className="flex justify-between items-center px-0.5">
                          <span
                            className={`text-xs w-6 h-6 flex items-center justify-center rounded-full leading-none ${
                              isToday
                                ? "bg-primary text-primary-foreground font-semibold shadow-sm ring-2 ring-primary/25"
                                : "text-muted-foreground/60 font-medium"
                            }`}
                          >
                            {day.getDate()}
                          </span>
                          {items.length > 0 && (
                            <button
                              onClick={() => openDay(dateStr)}
                              title={t("viewAllPostsOnDay", { count: items.length })}
                              aria-label={t("viewAllPostsOnDate", { count: items.length, date: day.toLocaleDateString(locale, { month: "long", day: "numeric" }) })}
                              className={`text-[9px] font-medium min-w-4 h-4 px-1 rounded-full transition-colors hover:bg-muted ${
                                isDayOpen ? "bg-muted text-foreground" : "text-muted-foreground/40 hover:text-foreground"
                              }`}
                            >
                              {items.length}
                            </button>
                          )}
                        </div>

                        <div className="flex-1 flex flex-col gap-1 min-h-0 overflow-hidden">
                          {items.slice(0, MAX).map((item) => {
                            const isItemSelected = selected !== null && selected.post.id === item.post.id;
                            return (
                              <VisualEventChip
                                key={item.post.id}
                                item={item}
                                isSelected={isItemSelected}
                                onClick={() => (isItemSelected ? closeRail() : openPost(item, false))}
                                onDragStart={handleDragStart(item.post)}
                              />
                            );
                          })}
                          {overflow > 0 && (
                            <button
                              className="text-[10px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors ps-2 text-start"
                              onClick={() => openDay(dateStr)}
                            >
                              {t("moreCount", { count: overflow })}
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
                    <p className="text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? t("noPostsMatchingFilters")
                        : t("noPostsThisMonthPeriod")}
                    </p>
                    {hasActiveFilters ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 rounded-xl"
                        onClick={clearFilters}
                      >
                        {t("clearFilters")}
                      </Button>
                    ) : (
                      <Link href="/content">
                        <Button variant="outline" size="sm" className="mt-4 rounded-xl gap-1.5">
                          <Plus className="h-3.5 w-3.5" /> {t("createPostCaps")}
                        </Button>
                      </Link>
                    )}
                  </div>
                ) : (
                  agendaDays.map(({ date, items }) => (
                    <MobileAgendaDay
                      key={isoDate(date)}
                      date={date}
                      items={items}
                      selected={selected}
                      onSelect={(item) => (item ? openPost(item, false) : closeRail())}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Side rail: sidebar on desktop ── */}
        {railOpen && (
          <div className="detail-panel shrink-0 rounded-xl border border-border/40 bg-card overflow-hidden hidden lg:block lg:w-[380px]">
            {renderRail()}
          </div>
        )}

        {/* ── Side rail: modal on mobile ── */}
        {railOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/50" onClick={closeRail} />
            <div
              className="absolute bottom-0 left-0 right-0 max-h-[85dvh] rounded-t-2xl bg-card overflow-hidden animate-in slide-in-from-bottom duration-200 flex flex-col"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              {renderRail()}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageContent />
    </Suspense>
  );
}
