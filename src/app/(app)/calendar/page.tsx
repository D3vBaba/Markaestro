"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import { AlertCircle, ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { toastApiError } from "@/lib/error-toast";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/app/PageHeader";
import Notice from "@/components/app/Notice";
import EmptyState from "@/components/app/EmptyState";
import Select from "@/components/app/Select";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import ScheduleSheet from "@/app/(app)/content/_components/ScheduleSheet";
import { Button } from "@/components/ui/button";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Pagination from "@/components/app/Pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Channel } from "@/components/mk/Channel";
import { PostThumbnail } from "@/components/mk/PostThumbnail";
import { channelLabel } from "@/components/mk/channels";

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
  evergreen?: { queueId: string; runId: string; sourcePostId: string; variantId: string };
  /** Resolved server-side: platform poster, first image, or the video asset's poster. */
  thumbnailUrl?: string | null;
};

/** A brand, as returned by /api/products (the storage name for brands). */
type Brand = {
  id: string;
  name: string;
  brandIdentity?: { logoUrl?: string; primaryColor?: string };
};

type CalendarItem = { kind: "post"; date: string; post: Post };

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

// ─── Constants ────────────────────────────────────────────────────────────────

// Channel names are platform brand names (Instagram, TikTok, ...), proper
// nouns that stay in English across every locale, same as elsewhere in the app.
// Order is the filter row order.
const CHANNEL_KEYS = ["instagram", "facebook", "tiktok", "threads", "pinterest", "linkedin", "x"] as const;

/** Statuses offered as filters. Drafts have no date and never land on the grid. */
const STATUS_FILTER_KEYS = ["published", "scheduled", "failed", "partial_failed"] as const;

/** Sentinel brand filter value matching posts that have no brand linked. */
const UNASSIGNED_BRAND = "none";

/** Month-cell chip: soft semantic background carries the status. */
const STATUS_CHIP: Record<string, string> = {
  published: "bg-mk-pos-soft text-mk-pos",
  scheduled: "bg-mk-accent-soft text-mk-accent",
  draft: "bg-muted text-mk-ink-80",
  failed: "bg-mk-neg-soft text-mk-neg",
  partial_failed: "bg-mk-warn-soft text-mk-warn",
  publishing: "bg-mk-warn-soft text-mk-warn",
};

/** Mobile day dots and filter dots. */
const STATUS_DOT: Record<string, string> = {
  published: "bg-mk-pos",
  scheduled: "bg-mk-accent",
  draft: "bg-mk-ink-40",
  failed: "bg-mk-neg",
  partial_failed: "bg-mk-warn",
  publishing: "bg-mk-warn",
};

const STATUS_BADGE: Record<string, BadgeVariant> = {
  published: "positive",
  scheduled: "accent",
  draft: "secondary",
  failed: "negative",
  partial_failed: "warning",
  publishing: "warning",
};

/** A day with this many posts or fewer lists them; busier days summarise by channel. */
const MAX_CHIPS_PER_CELL = 3;
type ViewMode = "month" | "week" | "list";
const VIEW_MODES: ViewMode[] = ["month", "week", "list"];

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay());
  return out;
}

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
// These imitate the target platform, so platform colours are deliberate here.

function InstagramMockup({ post }: { post: Post }) {
  const t = useTranslations("calendar.mockups");
  const img = post.mediaUrls?.[0];
  return (
    <div className="mx-auto max-w-[320px] overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-full p-[2px]" style={{ background: "linear-gradient(135deg, #f9ce34, #ee2a7b, #6228d7)" }}>
            <div className="flex size-full items-center justify-center rounded-full bg-card">
              <div className="size-5 rounded-full" style={{ background: "linear-gradient(135deg, #f9ce34, #ee2a7b, #6228d7)" }} />
            </div>
          </div>
          <div>
            <p className="m-0 text-[12px] font-semibold leading-none text-foreground">yourbrand</p>
            <p className="m-0 mt-0.5 text-[10px] text-mk-ink-40">{t("sponsored")}</p>
          </div>
        </div>
        <span className="text-lg leading-none text-mk-ink-40">···</span>
      </div>
      {img ? (
        isVideoUrl(img)
          ? <video src={img} className="aspect-square w-full object-cover" controls playsInline preload="metadata" />
          : <img src={img} alt="" className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted">
          <svg className="size-10 text-mk-ink-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
          </svg>
        </div>
      )}
      <div className="space-y-1.5 px-3 pb-3 pt-2.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>{t("like")}</span>
            <span>{t("comment")}</span>
            <span>{t("share")}</span>
          </div>
          <span>{t("save")}</span>
        </div>
        <p className="m-0 text-[12px] leading-snug text-foreground">
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
    <div className="mx-auto max-w-[320px] overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#1877F2]">
            <span className="text-xl font-black leading-none text-white">f</span>
          </div>
          <div>
            <p className="m-0 text-[13px] font-semibold leading-none text-foreground">Your Brand</p>
            <p className="m-0 mt-0.5 text-[10px] text-muted-foreground">{t("justNow")} · 🌐</p>
          </div>
        </div>
      </div>
      <p className="m-0 whitespace-pre-wrap px-3 pb-2 text-[13px] leading-snug text-foreground">
        {post.content.length > 200 ? post.content.slice(0, 200) + "…" : post.content}
      </p>
      {img && !isVideoUrl(img) && <img src={img} alt="" className="max-h-48 w-full object-cover" />}
      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center justify-around pt-1">
          {[t("likeAction"), t("commentAction"), t("shareAction")].map((l) => (
            <span key={l} className="flex-1 py-1 text-center text-[12px] font-medium text-muted-foreground">{l}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TikTokMockup({ post }: { post: Post }) {
  const img = post.mediaUrls?.[0];
  return (
    <div className="relative mx-auto aspect-[9/16] w-[180px]">
      <div className="absolute inset-0 overflow-hidden rounded-xl border border-border bg-black">
        {img ? (
          isVideoUrl(img)
            ? <video src={img} className="absolute inset-0 size-full object-cover opacity-75" controls playsInline preload="metadata" />
            : <img src={img} alt="" className="absolute inset-0 size-full object-cover opacity-75" />
        ) : null}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.15) 70%, rgba(0,0,0,0.3) 100%)" }} />
        <div className="absolute bottom-0 left-0 right-7 p-2.5">
          <p className="m-0 mb-0.5 text-[9px] font-semibold text-white">@yourbrand</p>
          <p className="m-0 line-clamp-3 text-[8px] leading-tight text-white/80">{post.content}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Panel scaffolding ────────────────────────────────────────────────────────
// The rail is an inline sidebar at `lg` and a Sheet below it. Both share this
// header / body / footer rhythm so the panel reads the same in either home.

const PANEL_HEADER = "flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6";
const PANEL_BODY = "min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-5";
const PANEL_FOOTER = "mt-auto flex flex-wrap items-center gap-2 border-t border-border px-5 py-4 sm:px-6";

// ─── Detail Panels ────────────────────────────────────────────────────────────

function PostDetailPanel({ post, onClose, onBack, brandName }: {
  post: Post;
  onClose: () => void;
  /** Present when the post was opened from a day list; returns to that list. */
  onBack?: () => void;
  brandName?: string;
}) {
  const t = useTranslations("calendar.detailPanel");
  const tStatus = useTranslations("calendar.statusLabels");
  const locale = useLocale();

  const statusDate = post.publishedAt || post.scheduledAt;
  const statusLabel = tStatus.has(post.status) ? tStatus(post.status) : post.status;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={PANEL_HEADER}>
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ms-2 shrink-0"
            onClick={onBack}
            aria-label={t("backToDay")}
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Channel channel={post.channel} size={20} />
            <p className="m-0 text-base font-semibold leading-6 text-foreground">
              {channelLabel(post.channel)}
            </p>
            <Badge variant={STATUS_BADGE[post.status] ?? "secondary"}>{statusLabel}</Badge>
            {post.evergreen && <Badge variant="positive">{t("evergreen")}</Badge>}
          </div>
          {(statusDate || brandName) && (
            <p className="m-0 mt-0.5 text-[13px] leading-5 text-muted-foreground tabular-nums">
              {statusDate && (
                <>
                  {post.status === "published" ? t("published") : t("scheduled")} · {formatDate(statusDate, locale)} {formatTime(statusDate, locale)}
                </>
              )}
              {statusDate && brandName && " · "}
              {brandName}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-me-2 shrink-0"
          onClick={onClose}
          aria-label={t("close")}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className={PANEL_BODY}>
        <div>
          <p className="mk-label m-0 mb-3">{t("preview")}</p>
          {post.channel === "instagram" && <InstagramMockup post={post} />}
          {post.channel === "facebook" && <FacebookMockup post={post} />}
          {post.channel === "tiktok" && <TikTokMockup post={post} />}
          {!["instagram", "facebook", "tiktok"].includes(post.channel) && (
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-mk-ink-80">{post.content}</p>
            </div>
          )}
        </div>
        {post.errorMessage && (
          <Notice tone="negative" icon={AlertCircle}>
            {t("failedToPublish")}
          </Notice>
        )}
      </div>
      {post.externalUrl && (
        <div className={cn(PANEL_FOOTER, "justify-end")}>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("close")}
          </Button>
          <Button size="sm" asChild>
            <a href={post.externalUrl} target="_blank" rel="noopener noreferrer">
              {t("viewLivePost")}
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Post chips and rows ──────────────────────────────────────────────────────

/** Month-cell chip: channel glyph, one truncated line, status as background. */
function PostChip({ item, onClick, isSelected, onDragStart }: {
  item: CalendarItem;
  onClick: () => void;
  isSelected: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const t = useTranslations("calendar.detailPanel");
  const p = item.post;
  const draggable = p.status === "scheduled" || p.status === "draft";
  const isFailed = p.status === "failed" || p.status === "partial_failed";

  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      title={isFailed ? t("failedToPublish") : undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-start text-[11.5px] font-medium leading-4 transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.98]",
        draggable && "cursor-grab active:cursor-grabbing",
        STATUS_CHIP[p.status] ?? STATUS_CHIP.draft,
        isSelected && "ring-1 ring-foreground",
      )}
    >
      <span className="flex shrink-0">
        <Channel channel={p.channel} size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate">{p.content || t("untitledPost")}</span>
      {isFailed && <AlertCircle className="size-3 shrink-0" aria-label={t("failedToPublish")} />}
    </button>
  );
}

/** List row for day lists: time, caption snippet and status, so a day is
 *  reviewable without opening every post. */
function PostRow({ item, onClick, isSelected, onDragStart, className }: {
  item: CalendarItem;
  onClick: () => void;
  isSelected: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  className?: string;
}) {
  const t = useTranslations("calendar.detailPanel");
  const tStatus = useTranslations("calendar.statusLabels");
  const locale = useLocale();
  const p = item.post;
  const thumb = p.mediaUrls?.[0];
  const draggable = Boolean(onDragStart) && (p.status === "scheduled" || p.status === "draft");
  const isFailed = p.status === "failed" || p.status === "partial_failed";
  const when = p.publishedAt || p.scheduledAt;
  const statusLabel = tStatus.has(p.status) ? tStatus(p.status) : p.status;

  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      aria-pressed={isSelected}
      title={isFailed ? t("failedToPublish") : undefined}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/60 sm:px-5",
        draggable && "cursor-grab active:cursor-grabbing",
        isSelected && "bg-muted",
        className,
      )}
    >
      <PostThumbnail src={p.thumbnailUrl} mediaUrl={thumb ?? null} channel={p.channel} size={40} />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[13px] font-medium leading-5 text-foreground">
          {p.content || t("untitledPost")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {when && (
            <span className="text-xs tabular-nums text-muted-foreground">{formatTime(when, locale)}</span>
          )}
          <Badge variant={STATUS_BADGE[p.status] ?? "secondary"}>{statusLabel}</Badge>
          {p.evergreen && <Badge variant="positive">{t("evergreen")}</Badge>}
        </div>
      </div>
      {isFailed && <AlertCircle className="size-4 shrink-0 text-mk-neg" aria-label={t("failedToPublish")} />}
    </button>
  );
}

// ─── Day Posts Panel ─────────────────────────────────────────────────────────
// A month cell only has room for a few chips. This lists every post on a single
// day so busy days stay fully reviewable.

function DayPostsPanel({ dateStr, items, onSelect, onClose, onDragStart, onBulkChanged }: {
  dateStr: string;
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
  onClose: () => void;
  /** Lets rows be dragged onto the grid to reschedule, same as cell chips. */
  onDragStart: (post: Post) => (e: React.DragEvent) => void;
  /** Refetch after a bulk operation lands. */
  onBulkChanged: () => Promise<void> | void;
}) {
  const t = useTranslations("calendar.dayPanel");
  const locale = useLocale();
  const date = parseIsoDate(dateStr);
  const isToday = dateStr === isoDate(new Date());

  // Multi-select lives here, in the day list, and deliberately NOT on the
  // month grid: the grid chips already carry click-to-open and
  // drag-to-reschedule, and a third gesture on a 20px chip would fight both.
  // While selecting, rows toggle instead of opening and dragging is off, so
  // the two modes can never race.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  // A different day means a different list; stale selections must not carry
  // an invisible post id into a bulk delete. Adjusted during render rather
  // than in an effect (same pattern as ScheduledTab's brand reset) so the
  // new day's first render is already deselected.
  const [panelDate, setPanelDate] = useState(dateStr);
  if (panelDate !== dateStr) {
    setPanelDate(dateStr);
    setSelecting(false);
    setSelectedIds(new Set());
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.post.id));

  /** Same honest partial-success reporting as the scheduled list. */
  const runBulk = async (
    body: Record<string, unknown>,
    successKey: "rescheduled" | "movedToDrafts" | "deleted",
  ) => {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkPending) return;
    setBulkPending(true);
    try {
      const res = await apiPost<{
        succeeded?: string[];
        failed?: Array<{ id: string; error: string }>;
      }>("/api/posts/bulk", { ids, ...body });
      const succeeded = res.data?.succeeded?.length ?? 0;
      const failed = res.data?.failed?.length ?? 0;
      if (!res.ok && succeeded === 0) {
        toast.error(t("bulkToasts.failed"));
        return;
      }
      if (failed > 0) {
        toast.warning(t("bulkToasts.partial", { succeeded, total: ids.length, failed }));
      } else {
        toast.success(t(`bulkToasts.${successKey}`, { count: succeeded }));
      }
      exitSelection();
      await onBulkChanged();
    } finally {
      setBulkPending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={PANEL_HEADER}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 truncate text-base font-semibold leading-6 text-foreground">
              {date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })}
            </p>
            {isToday && <Badge variant="default">{t("today")}</Badge>}
          </div>
          <p className="m-0 mt-0.5 text-[13px] leading-5 text-muted-foreground">
            {selecting
              ? t("selection.count", { count: selectedIds.size })
              : t("postCount", { count: items.length })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {items.length > 0 && (
            <Button
              variant={selecting ? "secondary" : "ghost"}
              size="xs"
              onClick={() => (selecting ? exitSelection() : setSelecting(true))}
            >
              {selecting ? t("selection.cancelSelection") : t("selection.selectMode")}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" className="-me-2" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="m-0 px-5 py-10 text-center text-[13px] text-muted-foreground">
            {t("noPosts")}
          </p>
        ) : (
          <ul className="m-0 list-none divide-y divide-border p-0">
            {items.map((item) => (
              <li key={item.post.id} className="relative">
                {selecting ? (
                  <>
                    <input
                      type="checkbox"
                      className="absolute start-4 top-1/2 z-10 size-4 -translate-y-1/2 cursor-pointer rounded accent-foreground sm:start-5"
                      checked={selectedIds.has(item.post.id)}
                      onChange={() => toggleSelected(item.post.id)}
                      aria-label={item.post.content?.slice(0, 80) || item.post.id}
                    />
                    <PostRow
                      item={item}
                      isSelected={selectedIds.has(item.post.id)}
                      onClick={() => toggleSelected(item.post.id)}
                      className="ps-11 sm:ps-12"
                    />
                  </>
                ) : (
                  <PostRow
                    item={item}
                    isSelected={false}
                    onClick={() => onSelect(item)}
                    onDragStart={onDragStart(item.post)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {selecting && (
        <div className={cn(PANEL_FOOTER, "px-4 py-3 sm:px-5")}>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.post.id)))
            }
          >
            {allSelected ? t("selection.clear") : t("selection.selectAll")}
          </Button>
          <span className="flex-1" />
          <Button
            size="xs"
            variant="outline"
            disabled={selectedIds.size === 0 || bulkPending}
            onClick={() => setRescheduleOpen(true)}
          >
            {t("selection.reschedule")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={selectedIds.size === 0 || bulkPending}
            onClick={() => runBulk({ action: "status", status: "draft" }, "movedToDrafts")}
          >
            {t("selection.moveToDrafts")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="text-mk-neg hover:bg-mk-neg-soft hover:text-mk-neg"
            disabled={selectedIds.size === 0 || bulkPending}
            onClick={() => setConfirmBulkDelete(true)}
          >
            {t("selection.delete")}
          </Button>
        </div>
      )}

      <ScheduleSheet
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        onSchedule={(when) => {
          setRescheduleOpen(false);
          void runBulk({ action: "reschedule", scheduledAt: when }, "rescheduled");
        }}
        initialDate={`${dateStr}T12:00:00.000Z`}
      />

      <ConfirmDeleteDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        entity="post"
        name={t("selection.count", { count: selectedIds.size })}
        warning={t("selection.confirmDeleteBody")}
        onConfirm={async () => {
          setConfirmBulkDelete(false);
          await runBulk({ action: "delete" }, "deleted");
        }}
      />
    </div>
  );
}

// ─── Grid pieces ─────────────────────────────────────────────────────────────

function WeekdayHeader({ dayNames, compact = false }: { dayNames: string[]; compact?: boolean }) {
  return (
    <div className="grid grid-cols-7 border-b border-border bg-muted/60">
      {dayNames.map((d) => (
        <div key={d} className={cn("mk-label text-center", compact ? "py-1.5 text-[11px]" : "py-2")}>
          {d}
        </div>
      ))}
    </div>
  );
}

/** Same shape as the month grid, so the page does not jump when data lands. */
function CalendarSkeleton({ dayNames }: { dayNames: string[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" aria-busy="true">
      <WeekdayHeader dayNames={dayNames} />
      <div className="grid grid-cols-7 gap-px bg-border">
        {Array.from({ length: 35 }).map((_, i) => (
          <div
            key={i}
            className="flex aspect-square flex-col gap-1.5 bg-card p-2 sm:aspect-auto sm:min-h-[9.5rem] lg:min-h-[10.5rem]"
          >
            <Skeleton className="size-6 rounded-full" />
            {i % 3 === 0 && <Skeleton className="hidden h-4 w-full sm:block" />}
            {i % 4 === 1 && <Skeleton className="hidden h-4 w-3/4 sm:block" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayNumber({ day, isToday }: { day: number; isToday: boolean }) {
  return (
    <span
      className={cn(
        "grid size-6 place-items-center rounded-full text-xs leading-none tabular-nums",
        isToday ? "bg-foreground font-semibold text-background" : "font-medium text-muted-foreground",
      )}
    >
      {day}
    </span>
  );
}

/**
 * Busy-day summary: one line per channel with its count, then a thin status
 * bar. At twenty posts a day a list of truncated captions says nothing; the
 * mix of channels and how much is still scheduled does.
 */
function ChannelSummary({ items, onOpen, label }: { items: CalendarItem[]; onOpen: () => void; label: string }) {
  const t = useTranslations("calendar");
  const byChannel = new Map<string, number>();
  const byStatus = { published: 0, scheduled: 0, failed: 0, other: 0 };
  for (const item of items) {
    byChannel.set(item.post.channel, (byChannel.get(item.post.channel) ?? 0) + 1);
    const st = item.post.status;
    if (st === "published") byStatus.published += 1;
    else if (st === "scheduled") byStatus.scheduled += 1;
    else if (st === "failed" || st === "partial_failed") byStatus.failed += 1;
    else byStatus.other += 1;
  }
  const rows = [...byChannel.entries()].sort((a, b) => b[1] - a[1]);
  const shown = rows.slice(0, 4);
  const rest = rows.length - shown.length;
  const total = items.length || 1;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="flex min-h-0 flex-1 flex-col justify-between gap-2 rounded-lg px-1 py-1 text-start transition-colors hover:bg-muted/60"
    >
      <ul className="m-0 grid list-none gap-1 p-0">
        {shown.map(([channel, count]) => (
          <li key={channel} className="flex items-center gap-1.5 text-xs text-mk-ink-80">
            <Channel channel={channel} size={16} />
            <span className="truncate">{channelLabel(channel)}</span>
            <span className="ms-auto tabular-nums text-muted-foreground">{count}</span>
          </li>
        ))}
        {rest > 0 && <li className="text-xs text-mk-ink-40">{t("moreChannels", { count: rest })}</li>}
      </ul>
      <span className="flex h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="bg-mk-pos" style={{ width: `${(byStatus.published / total) * 100}%` }} />
        <span className="bg-mk-accent" style={{ width: `${(byStatus.scheduled / total) * 100}%` }} />
        <span className="bg-mk-neg" style={{ width: `${(byStatus.failed / total) * 100}%` }} />
      </span>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function CalendarPageContent() {
  const t = useTranslations("calendar");
  const tStatus = useTranslations("calendar.statusLabels");
  const tView = useTranslations("calendar.views");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The rail is inline at `lg` (so day-list rows can still be dragged onto the
  // grid) and a Sheet below it. Only one of the two ever mounts.
  const isDesktop = useMediaQuery("(min-width: 1024px)", true);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [view, setView] = useState<ViewMode>(() => {
    const requested = searchParams.get("view");
    return VIEW_MODES.includes(requested as ViewMode) ? (requested as ViewMode) : "month";
  });
  // Week view anchors on the week containing today when viewing this month,
  // otherwise the first week of the month.
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(today));
  // List view pages through the month a week of days at a time.
  const [listPage, setListPage] = useState(1);
  const [listPagedFor, setListPagedFor] = useState(`${year}-${month}`);
  if (listPagedFor !== `${year}-${month}`) { setListPagedFor(`${year}-${month}`); setListPage(1); }
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
  // Optimistic patches (postId to patched fields) layered over query data so
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
  // ISO date highlighted in the compact mobile grid; its posts list under the
  // grid. Falls back to today (or the 1st) when it is not in the viewed month.
  const [mobileDay, setMobileDay] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<Post | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Filters initialize from URL (?status=...&channel=...&brand=...) so dashboard
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

    // Otherwise ask the API definitively: the post may simply be outside
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
        // A reschedule is refused for specific, statable reasons (the post is
        // mid-publish, the time is in the past, the channel is not ready).
        // The chip snapping back with a generic toast told the user none of
        // them.
        toastApiError(res.data, t("rescheduleFailedToast"));
      }
    } catch {
      clearOverride(post.id);
      toast.error(t("rescheduleFailedToast"));
    }
  };

  // Build date to items map (with filters applied)
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
  const isCurrentMonth = month === today.getMonth() && year === today.getFullYear();

  // ─── Side rail: day list <-> single-post preview ─────────────────────
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

  // Rendered in one of two homes (desktop sidebar or Sheet); never both.
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
          onBulkChanged={async () => {
            invalidateQueries("/api/posts");
            await refresh();
          }}
        />
      );
    }
    return null;
  };
  // Accessible name for the Sheet; the visible header lives inside the panel.
  const railTitle = selected
    ? channelLabel(selected.post.channel)
    : dayView
      ? parseIsoDate(dayView).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })
      : "";

  // Escape steps back through the rail: post, then day list, then closed.
  // The Sheet handles this itself below `lg` (see onEscapeKeyDown).
  useEffect(() => {
    if (!railOpen || !isDesktop) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // From a post opened out of a day list, step back to the list first.
      if (selected && dayView) setSelected(null);
      else { setSelected(null); setDayView(null); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [railOpen, isDesktop, selected, dayView]);

  const prevMonth = () => month === 0 ? (setMonth(11), setYear(y => y - 1)) : setMonth(m => m - 1);
  const nextMonth = () => month === 11 ? (setMonth(0), setYear(y => y + 1)) : setMonth(m => m + 1);
  // In week view the arrows walk weeks; the loaded month follows the week's
  // Thursday so a week straddling two months still has most of its posts.
  const shiftWeek = (delta: number) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + delta * 7);
    setWeekStart(next);
    const mid = new Date(next);
    mid.setDate(mid.getDate() + 3);
    if (mid.getMonth() !== month || mid.getFullYear() !== year) {
      setMonth(mid.getMonth());
      setYear(mid.getFullYear());
    }
  };
  const goPrev = () => (view === "week" ? shiftWeek(-1) : prevMonth());
  const goNext = () => (view === "week" ? shiftWeek(1) : nextMonth());
  const selectView = (next: ViewMode) => {
    setView(next);
    if (next === "week") {
      const inMonth = today.getMonth() === month && today.getFullYear() === year;
      setWeekStart(startOfWeek(inMonth ? today : new Date(year, month, 1)));
    }
    const params = new URLSearchParams(searchParams.toString());
    if (next === "month") params.delete("view"); else params.set("view", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const weekLabel = t("weekOf", { date: weekStart.toLocaleDateString(locale, { month: "short", day: "numeric" }) });

  // Count totals for month (respects active filter)
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const totalPosts = filteredPosts.filter(p => {
    const d = getDateForPost(p);
    return d && d.startsWith(monthPrefix);
  }).length;

  // Mobile: the highlighted day and its posts.
  const mobileDayStr =
    mobileDay && mobileDay.startsWith(monthPrefix)
      ? mobileDay
      : isCurrentMonth
        ? todayStr
        : `${monthPrefix}-01`;
  const mobileItems = itemsByDate.get(mobileDayStr) ?? [];
  const mobileDate = parseIsoDate(mobileDayStr);

  const subtitle = dragItem
    ? `${t("postsThisMonth", { count: totalPosts })} ${t("dropToReschedule")}`
    : t("postsThisMonth", { count: totalPosts });

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={subtitle}
        action={
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" onClick={goPrev} aria-label={t("views.month")}>
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </Button>
              <span className="min-w-[12ch] px-1 text-center text-sm font-semibold capitalize tabular-nums text-foreground">
                {view === "week" ? weekLabel : `${monthLabel} ${year}`}
              </span>
              <Button variant="outline" size="icon-sm" onClick={goNext} aria-label={t("views.month")}>
                <ChevronRight className="size-4 rtl:rotate-180" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={isCurrentMonth && (view !== "week" || isoDate(weekStart) === isoDate(startOfWeek(today)))}
              onClick={() => { setMonth(today.getMonth()); setYear(today.getFullYear()); setWeekStart(startOfWeek(today)); closeRail(); }}
            >
              {t("today")}
            </Button>
            <Tabs value={view} onValueChange={(v) => selectView(v as ViewMode)}>
              <TabsList className="h-8">
                {VIEW_MODES.map((mode) => (
                  <TabsTrigger key={mode} value={mode} className="px-2.5 text-xs">{tView(mode)}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button size="sm" asChild>
              <Link href="/content">
                <Plus className="size-4" />
                {t("newPost")}
              </Link>
            </Button>
          </>
        }
      >
        {/* Filters. Toggles for status and channel; a select for brands, since a
            workspace can have many and the row is already dense. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTER_KEYS.map((key) => {
            const active = statusFilter === key;
            return (
              <Button
                key={key}
                variant={active ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={active}
                onClick={() => applyFilters({ status: active ? null : key })}
              >
                <span className={cn("size-1.5 rounded-full", STATUS_DOT[key])} aria-hidden />
                {tStatus(key)}
              </Button>
            );
          })}
          <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
          {CHANNEL_KEYS.map((key) => {
            const active = channelFilter === key;
            return (
              <Button
                key={key}
                variant={active ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={active}
                onClick={() => applyFilters({ channel: active ? null : key })}
              >
                <Channel channel={key} size={14} />
                {channelLabel(key)}
              </Button>
            );
          })}
          {(brands.length > 0 || brandFilter) && (
            <>
              <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
              <Select
                size="sm"
                value={brandFilter ?? ""}
                onChange={(e) => applyFilters({ brand: e.target.value || null })}
                aria-label={t("filters.brand")}
                className="w-auto max-w-44 h-7 rounded-md text-xs"
              >
                <option value="">{t("filters.brand")}: {t("filters.all")}</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
                {(hasUnassignedPosts || brandFilter === UNASSIGNED_BRAND) && (
                  <option value={UNASSIGNED_BRAND}>{t("filters.noBrand")}</option>
                )}
                {/* Keeps the control in sync when ?brand= names a brand that
                    hasn't loaded yet or has since been deleted. */}
                {unknownBrandId && <option value={unknownBrandId}>{t("filters.unknownBrand")}</option>}
              </Select>
            </>
          )}
          <span className="ms-auto hidden text-xs text-muted-foreground md:inline">
            {t("filters.dragToReschedule")}
          </span>
        </div>
      </PageHeader>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* ── Calendar column ── */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Deleted-post notice: shown when a deep link points at a post
              that no longer exists (e.g. an old "Recent posts" link) */}
          {deletedNotice && (
            <Notice
              tone="neutral"
              icon={AlertCircle}
              action={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDeletedNotice(false)}
                  aria-label={t("dismiss")}
                >
                  <X className="size-4" />
                </Button>
              }
            >
              {t("deletedNotice")}
            </Notice>
          )}

          {/* Safety-ceiling notice: the month held more posts than one read
              returns, so the grid below is incomplete. Should not happen in
              practice; shown rather than silently dropping posts. */}
          {postsData?.truncated && (
            <Notice tone="warning" icon={AlertCircle}>
              {t("truncatedNotice")}
            </Notice>
          )}

          {/* Grid. Skeleton only on true initial load; post-mutation refetches
              keep the (optimistically patched) grid on screen */}
          {loading && !postsData ? (
            <CalendarSkeleton dayNames={dayNames} />
          ) : loadError && !postsData ? (
            <Notice
              tone="negative"
              icon={AlertCircle}
              action={
                <Button variant="outline" size="sm" onClick={() => refresh()}>
                  {t("retry")}
                </Button>
              }
            >
              {t("loadError")}
            </Notice>
          ) : (
            <>
              {/* Empty state acknowledges active filters; the grid stays so
                  the month can still be browsed. */}
              {totalPosts === 0 && (
                <EmptyState
                  compact
                  icon={CalendarDays}
                  title={hasActiveFilters ? t("noPostsMatchingFilters") : t("noPostsThisMonth")}
                  action={
                    hasActiveFilters ? (
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        {t("clearFilters")}
                      </Button>
                    ) : (
                      <Button size="sm" asChild>
                        <Link href="/content">
                          <Plus className="size-4" />
                          {t("createPost")}
                        </Link>
                      </Button>
                    )
                  }
                />
              )}

              {/* Month grid (sm and up) */}
              {view === "month" && (
              <div className="hidden overflow-hidden rounded-xl border border-border bg-card sm:block">
                <WeekdayHeader dayNames={dayNames} />
                <div className="grid grid-cols-7 gap-px bg-border">
                  {days.map((day, idx) => {
                    if (!day) {
                      return <div key={`pad-${idx}`} className="min-h-[9.5rem] bg-muted/40 lg:min-h-[10.5rem]" />;
                    }

                    const dateStr = isoDate(day);
                    const isToday = dateStr === todayStr;
                    const items = itemsByDate.get(dateStr) || [];
                    const isDropTarget = dropTarget === dateStr;
                    const isDayOpen = dayView === dateStr;
                    const dayLabel = t("viewAllPostsOnDate", { count: items.length, date: day.toLocaleDateString(locale, { month: "long", day: "numeric" }) });

                    return (
                      <div
                        key={dateStr}
                        className={cn(
                          "flex min-h-[9.5rem] flex-col gap-1.5 p-2 transition-colors lg:min-h-[10.5rem]",
                          isDayOpen ? "bg-mk-accent-soft/60" : "bg-card",
                          isDropTarget && "bg-mk-accent-soft ring-1 ring-inset ring-mk-accent",
                        )}
                        onDragOver={handleDragOver(dateStr)}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop(dateStr)}
                      >
                        <div className="flex items-center justify-between">
                          <DayNumber day={day.getDate()} isToday={isToday} />
                          {items.length > 0 && (
                            <button
                              type="button"
                              onClick={() => openDay(dateStr)}
                              title={t("viewAllPostsOnDay", { count: items.length })}
                              aria-label={dayLabel}
                              className={cn(
                                "rounded-md px-1.5 py-0.5 text-xs font-medium leading-4 tabular-nums transition-colors hover:bg-muted hover:text-foreground",
                                isDayOpen ? "bg-card text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {items.length}
                            </button>
                          )}
                        </div>

                        {items.length === 0 ? null : items.length <= MAX_CHIPS_PER_CELL ? (
                          <div className="flex min-h-0 flex-1 flex-col gap-1">
                            {items.map((item) => {
                              const isItemSelected = selected !== null && selected.post.id === item.post.id;
                              return (
                                <PostChip
                                  key={item.post.id}
                                  item={item}
                                  isSelected={isItemSelected}
                                  onClick={() => (isItemSelected ? closeRail() : openPost(item, false))}
                                  onDragStart={handleDragStart(item.post)}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <ChannelSummary items={items} onOpen={() => openDay(dateStr)} label={dayLabel} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Week view: seven day columns, each a full post list */}
              {view === "week" && (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-7 sm:divide-x sm:divide-y-0">
                    {weekDays.map((day) => {
                      const dateStr = isoDate(day);
                      const isToday = dateStr === todayStr;
                      const inMonth = day.getMonth() === month && day.getFullYear() === year;
                      const items = itemsByDate.get(dateStr) || [];
                      const isDropTarget = dropTarget === dateStr;
                      return (
                        <section
                          key={dateStr}
                          className={cn("flex min-h-[12rem] min-w-0 flex-col", !inMonth && "bg-muted/40", isDropTarget && "bg-mk-accent-soft")}
                          onDragOver={inMonth ? handleDragOver(dateStr) : undefined}
                          onDragLeave={handleDragLeave}
                          onDrop={inMonth ? handleDrop(dateStr) : undefined}
                        >
                          <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                            <span className={cn("text-xs font-medium", isToday ? "text-mk-accent" : "text-muted-foreground")}>
                              {day.toLocaleDateString(locale, { weekday: "short" })}
                            </span>
                            <DayNumber day={day.getDate()} isToday={isToday} />
                            {items.length > 0 && (
                              <span className="ms-auto text-xs tabular-nums text-muted-foreground">{items.length}</span>
                            )}
                          </header>
                          {items.length === 0 ? (
                            <p className="m-0 px-3 py-6 text-center text-xs text-mk-ink-40">{t("dayPanel.noPosts")}</p>
                          ) : (
                            <ul className="m-0 flex list-none flex-col gap-1.5 p-2">
                              {items.map((item) => {
                                const isItemSelected = selected !== null && selected.post.id === item.post.id;
                                const p = item.post;
                                const thumb = p.mediaUrls?.[0];
                                const when = p.publishedAt || p.scheduledAt;
                                return (
                                  <li key={p.id}>
                                    <button
                                      type="button"
                                      draggable={p.status === "scheduled" || p.status === "draft"}
                                      onDragStart={handleDragStart(p)}
                                      onClick={() => (isItemSelected ? closeRail() : openPost(item, false))}
                                      aria-pressed={isItemSelected}
                                      className={cn(
                                        "flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card p-2 text-start transition-colors hover:border-mk-ink-20",
                                        isItemSelected && "border-mk-accent ring-1 ring-mk-accent",
                                      )}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <Channel channel={p.channel} size={16} />
                                        {when && <span className="text-xs tabular-nums text-muted-foreground">{formatTime(when, locale)}</span>}
                                        <span className={cn("ms-auto size-1.5 rounded-full", STATUS_DOT[p.status] ?? "bg-mk-ink-40")} aria-hidden />
                                      </div>
                                      {(p.thumbnailUrl || (thumb && !isVideoUrl(thumb))) ? (
                                        <img src={p.thumbnailUrl || thumb!} alt="" className="aspect-[4/3] w-full rounded-md object-cover" draggable={false} loading="lazy" />
                                      ) : thumb ? (
                                        <video src={`${thumb}#t=0.1`} muted playsInline preload="metadata" className="aspect-[4/3] w-full rounded-md bg-muted object-cover" tabIndex={-1} />
                                      ) : null}
                                      <p className="m-0 line-clamp-2 text-xs leading-4 text-foreground">{p.content || t("detailPanel.untitledPost")}</p>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* List view: the month as an agenda, grouped by day */}
              {view === "list" && (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {totalPosts === 0 ? (
                    <p className="m-0 px-4 py-10 text-center text-[13px] text-muted-foreground">{t("listEmpty")}</p>
                  ) : (
                    (() => {
                      const allDays = [...itemsByDate.entries()].sort(([a], [b]) => a.localeCompare(b));
                      const listTotalPages = Math.max(1, Math.ceil(allDays.length / 7));
                      const pageDays = allDays.slice((listPage - 1) * 7, listPage * 7);
                      return (
                        <>
                          {pageDays.map(([dateStr, items]) => {
                      const date = parseIsoDate(dateStr);
                      return (
                        <section key={dateStr} className="border-b border-border last:border-b-0">
                          <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2 sm:px-5">
                            <p className="m-0 text-[13px] font-semibold text-foreground">
                              {date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })}
                            </p>
                            {dateStr === todayStr && <Badge variant="accent">{t("agenda.today")}</Badge>}
                            <span className="ms-auto text-xs tabular-nums text-muted-foreground">{t("agenda.itemCount", { count: items.length })}</span>
                          </header>
                          <ul className="m-0 list-none divide-y divide-border p-0">
                            {items.map((item) => {
                              const isItemSelected = selected !== null && selected.post.id === item.post.id;
                              return (
                                <li key={item.post.id}>
                                  <PostRow
                                    item={item}
                                    isSelected={isItemSelected}
                                    onClick={() => (isItemSelected ? closeRail() : openPost(item, false))}
                                    onDragStart={isDesktop ? handleDragStart(item.post) : undefined}
                                  />
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      );
                          })}
                          {listTotalPages > 1 && (
                            <div className="px-4 pb-4">
                              <Pagination page={listPage} totalPages={listTotalPages} onPageChange={setListPage} />
                            </div>
                          )}
                        </>
                      );
                    })()
                  )}
                </div>
              )}

              {/* Compact grid + selected day list (below sm) */}
              {view === "month" && (
              <div className="space-y-4 sm:hidden">
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <WeekdayHeader dayNames={dayNames} compact />
                  <div className="grid grid-cols-7 gap-px bg-border">
                    {days.map((day, idx) => {
                      if (!day) {
                        return <div key={`pad-${idx}`} className="aspect-square bg-muted/40" />;
                      }
                      const dateStr = isoDate(day);
                      const isToday = dateStr === todayStr;
                      const isSelectedDay = dateStr === mobileDayStr;
                      const items = itemsByDate.get(dateStr) || [];
                      return (
                        <button
                          key={dateStr}
                          type="button"
                          onClick={() => setMobileDay(dateStr)}
                          aria-pressed={isSelectedDay}
                          aria-label={day.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })}
                          className={cn(
                            "flex aspect-square flex-col items-center justify-center gap-1 transition-colors",
                            isSelectedDay ? "bg-muted" : "bg-card",
                          )}
                        >
                          <DayNumber day={day.getDate()} isToday={isToday} />
                          <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                            {items.slice(0, 3).map((item) => (
                              <span
                                key={item.post.id}
                                className={cn("size-1.5 rounded-full", STATUS_DOT[item.post.status] ?? "bg-mk-ink-40")}
                              />
                            ))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <p className="m-0 min-w-0 truncate text-sm font-semibold text-foreground">
                      {mobileDate.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}
                    </p>
                    {mobileDayStr === todayStr && <Badge variant="default">{t("agenda.today")}</Badge>}
                    <span className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {t("agenda.itemCount", { count: mobileItems.length })}
                    </span>
                  </div>
                  {mobileItems.length === 0 ? (
                    <p className="m-0 px-4 py-8 text-center text-[13px] text-muted-foreground">
                      {t("dayPanel.noPosts")}
                    </p>
                  ) : (
                    <ul className="m-0 list-none divide-y divide-border p-0">
                      {mobileItems.map((item) => {
                        const isItemSelected = selected !== null && selected.post.id === item.post.id;
                        return (
                          <li key={item.post.id}>
                            <PostRow
                              item={item}
                              isSelected={isItemSelected}
                              onClick={() => (isItemSelected ? closeRail() : openPost(item, false))}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
              )}
            </>
          )}
        </div>

        {/* ── Side rail: inline sidebar at lg ── */}
        {railOpen && isDesktop && (
          <aside className="hidden max-h-[calc(100dvh-6rem)] w-[380px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card animate-in fade-in-0 duration-200 lg:sticky lg:top-20 lg:flex">
            {renderRail()}
          </aside>
        )}
      </div>

      {/* ── Side rail: bottom sheet below lg ── */}
      <Sheet open={railOpen && !isDesktop} onOpenChange={(open) => { if (!open) closeRail(); }}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
          className="max-h-[85dvh] gap-0"
          onEscapeKeyDown={(e) => {
            // From a post opened out of a day list, step back to the list first.
            if (selected && dayView) {
              e.preventDefault();
              setSelected(null);
            }
          }}
        >
          <SheetTitle className="sr-only">{railTitle}</SheetTitle>
          {renderRail()}
        </SheetContent>
      </Sheet>
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
