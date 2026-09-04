"use client";

/**
 * The media gallery: what a user reaches for when `QUOTA_EXCEEDED_STORAGE`
 * hits. Storage is metered and capped per plan, and until this surface
 * existed a customer who filled their cap had no way to free a single byte.
 * The whole design serves the space-is-full moment:
 *
 * - The meter is always visible and turns amber, then red, as the cap nears;
 *   past 80% it also says what to do (delete, largest first) instead of just
 *   glowing.
 * - "Largest" sort answers the only question a full workspace has: what
 *   costs the most. "Not used" lists what can go without any post noticing —
 *   reference counts are maintained on every post create, edit, and delete.
 * - Multi-select keeps a running byte tally, so "select until it fits" is a
 *   visible act rather than arithmetic.
 * - Bulk delete runs the same per-asset server checks as single delete:
 *   assets a scheduled or publishing post still needs are refused there and
 *   reported here as skipped, never silently destroyed.
 */

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Trash2, ImageIcon, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { apiDelete, apiGet } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { userFacingError } from "@/lib/user-facing-errors";
import { toast } from "sonner";

type MediaAssetRow = {
  id: string;
  type: "image" | "video";
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalFileName: string;
  createdByType: "user" | "api_client";
  createdAt: string;
  refCount: number;
  /** Derived 320px thumbnail; null until the worker produces it. */
  thumbnailUrl?: string | null;
  processingState?: "pending" | "ready";
};

type MediaListResponse = {
  assets: MediaAssetRow[];
  nextCursor: string | null;
  storage: { usedBytes: number; limitBytes: number };
};

/**
 * All / Images / Videos / Not used — mutually exclusive by design, so the
 * server never needs a filter-combination index and the toolbar stays legible.
 */
type GalleryFilter = "all" | "image" | "video" | "unused";
type GallerySort = "newest" | "largest";

const PAGE_SIZE = 30;
/** Above this ratio the meter turns amber and the cleanup hint appears. */
const METER_WARN_RATIO = 0.8;
const METER_DANGER_RATIO = 0.95;

function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units: Array<[number, string]> = [
    [1024 ** 3, "GB"],
    [1024 ** 2, "MB"],
    [1024, "KB"],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) {
      return `${(bytes / size).toLocaleString(locale, { maximumFractionDigits: 1 })} ${unit}`;
    }
  }
  return `${bytes} B`;
}

function formatDate(value: string, locale: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "n/a";
  return new Date(parsed).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

function listPath(filter: GalleryFilter, sort: GallerySort, cursor?: string): string {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  if (filter === "image" || filter === "video") params.set("type", filter);
  if (filter === "unused") params.set("unused", "1");
  if (sort === "largest") params.set("sort", "largest");
  if (cursor) params.set("cursor", cursor);
  return `/api/media?${params.toString()}`;
}

export default function MediaLibrary() {
  const t = useTranslations("settings.media");
  const locale = useLocale();

  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [sort, setSort] = useState<GallerySort>("newest");
  const [pending, setPending] = useState<MediaAssetRow | null>(null);

  // Pages after the first accumulate here; a filter or sort change resets
  // them, because a cursor belongs to one specific query shape.
  const [extraPages, setExtraPages] = useState<MediaAssetRow[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkState, setBulkState] = useState<{ done: number; total: number } | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const firstPagePath = listPath(filter, sort);
  const { data, loading } = useApiQuery<MediaListResponse>(firstPagePath);

  // A filter or sort switch invalidates the accumulated pages and any
  // selection of rows no longer visible. Render-time adjustment, keyed on
  // the query path, so the new view's first paint is already clean.
  const [pagedFor, setPagedFor] = useState(firstPagePath);
  if (pagedFor !== firstPagePath) {
    setPagedFor(firstPagePath);
    setExtraPages([]);
    setExtraCursor(null);
    setSelectedIds(new Set());
  }

  const assets = useMemo(() => {
    const first = data?.assets ?? [];
    const seen = new Set(first.map((asset) => asset.id));
    return [...first, ...extraPages.filter((asset) => !seen.has(asset.id))];
  }, [data, extraPages]);

  const nextCursor = extraCursor ?? data?.nextCursor ?? null;

  const storage = data?.storage;
  const limited = Boolean(storage && storage.limitBytes > 0);
  const usedRatio = limited && storage ? Math.min(1, storage.usedBytes / storage.limitBytes) : 0;
  const meterColor = usedRatio >= METER_DANGER_RATIO
    ? "var(--mk-neg)"
    : usedRatio >= METER_WARN_RATIO
      ? "var(--mk-warn)"
      : "var(--mk-pos)";

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedIds.has(asset.id)),
    [assets, selectedIds],
  );
  const selectedBytes = selectedAssets.reduce((sum, asset) => sum + asset.sizeBytes, 0);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiGet<MediaListResponse>(listPath(filter, sort, nextCursor));
      if (res.ok) {
        setExtraPages((cur) => [...cur, ...res.data.assets]);
        setExtraCursor(res.data.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, filter, sort]);

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

  const refetch = () => invalidateQueries("/api/media");

  const handleDelete = useCallback(async () => {
    if (!pending) return;
    try {
      const res = await apiDelete<{ warning?: string; bytesReleased?: number }>(`/api/media/${pending.id}`);
      if (!res.ok) {
        // The server names the blocking posts when an asset is still in use,
        // which is the only thing that tells the user what to do next.
        toast.error(userFacingError(res.data, t("deleteFailed")));
        return;
      }
      toast.success(
        res.data?.warning
          ? t("deletedWithWarning", { warning: res.data.warning })
          : t("deleted", { size: formatBytes(res.data?.bytesReleased ?? 0, locale) }),
      );
      refetch();
    } finally {
      setPending(null);
    }
  }, [pending, t, locale]);

  /**
   * Sequential on purpose: each delete runs the server's own in-use check,
   * and thirty concurrent deletes racing the storage counter and each
   * other's reference lookups buys nothing a user can feel. The progress
   * line keeps the sequence honest.
   */
  const handleBulkDelete = useCallback(async () => {
    const targets = selectedAssets;
    if (targets.length === 0) return;
    setBulkState({ done: 0, total: targets.length });

    let deleted = 0;
    let skipped = 0;
    let freedBytes = 0;
    for (const [index, asset] of targets.entries()) {
      try {
        const res = await apiDelete<{ bytesReleased?: number }>(`/api/media/${asset.id}`);
        if (res.ok) {
          deleted += 1;
          freedBytes += res.data?.bytesReleased ?? asset.sizeBytes;
        } else {
          // VALIDATION_MEDIA_IN_USE and friends: refused server-side, so a
          // scheduled post's media can never be bulk-deleted from under it.
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
      setBulkState({ done: index + 1, total: targets.length });
    }

    setBulkState(null);
    exitSelection();
    refetch();

    const size = formatBytes(freedBytes, locale);
    if (deleted === 0) {
      toast.error(t("bulk.failed"));
    } else if (skipped > 0) {
      toast.warning(t("bulk.partial", { deleted, total: targets.length, size, skipped }));
    } else {
      toast.success(t("bulk.done", { count: deleted, size }));
    }
  }, [selectedAssets, locale, t]);

  const filterChips: Array<{ id: GalleryFilter; label: string }> = [
    { id: "all", label: t("filters.all") },
    { id: "image", label: t("filters.images") },
    { id: "video", label: t("filters.videos") },
    { id: "unused", label: t("filters.unused") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
        </div>
        {storage && (
          <div className="w-full sm:w-64">
            <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="tabular-nums">
                {limited
                  ? t("meter.used", {
                      used: formatBytes(storage.usedBytes, locale),
                      limit: formatBytes(storage.limitBytes, locale),
                    })
                  : t("meter.usedUnlimited", { used: formatBytes(storage.usedBytes, locale) })}
              </span>
              {limited && (
                <span className="tabular-nums font-medium">
                  {Math.round(usedRatio * 100)}%
                </span>
              )}
            </div>
            {limited && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${Math.max(2, usedRatio * 100)}%`, background: meterColor }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {limited && usedRatio >= METER_WARN_RATIO && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: "color-mix(in oklch, var(--mk-warn) 40%, transparent)",
            background: "color-mix(in oklch, var(--mk-warn) 8%, transparent)",
          }}
        >
          <span>{t("meter.full", { percent: Math.round(usedRatio * 100) })}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 rounded-full text-[11px]"
            onClick={() => { setFilter("unused"); setSort("largest"); }}
          >
            {t("filters.unused")} · {t("sort.largest")}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {filterChips.map((chip) => (
          <button
            key={chip.id}
            onClick={() => setFilter(chip.id)}
            className={`h-8 sm:h-7 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
              filter === chip.id
                ? "border-foreground bg-foreground text-background"
                : "border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {chip.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border/60" aria-hidden />
        {(["newest", "largest"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setSort(option)}
            className={`h-8 sm:h-7 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
              sort === option
                ? "border-foreground bg-foreground text-background"
                : "border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {t(`sort.${option}`)}
          </button>
        ))}
        <div className="ms-auto">
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full text-[11px]"
            disabled={assets.length === 0 && !selecting}
            onClick={() => (selecting ? exitSelection() : setSelecting(true))}
          >
            {selecting ? t("selection.cancel") : t("selection.selectMode")}
          </Button>
        </div>
      </div>

      {filter === "unused" && assets.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{t("unusedHint")}</p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <p className="rounded-lg bg-muted/60 p-6 text-center text-[13px] text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => {
            const isSelected = selectedIds.has(asset.id);
            return (
              <figure
                key={asset.id}
                className={`group relative overflow-hidden rounded-lg border bg-card transition-colors ${
                  isSelected ? "border-foreground" : "border-border/30"
                }`}
              >
                <div
                  className={`relative flex aspect-square items-center justify-center bg-muted/40 ${
                    selecting ? "cursor-pointer" : ""
                  }`}
                  onClick={selecting ? () => toggleSelected(asset.id) : undefined}
                >
                  {asset.type === "image" ? (
                    <img
                      // ~20 KB per cell instead of the multi-MB original;
                      // fresh uploads fall back to the original until the
                      // worker derives their thumbnail.
                      src={asset.thumbnailUrl || asset.url}
                      alt={asset.originalFileName || t("untitled")}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <video src={asset.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                  )}

                  <span className="absolute left-2 bottom-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                    {asset.type === "video"
                      ? <Film className="size-3" aria-hidden />
                      : <ImageIcon className="size-3" aria-hidden />}
                    {formatBytes(asset.sizeBytes, locale)}
                  </span>

                  {asset.refCount === 0 && (
                    <span className="absolute right-2 bottom-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
                      {t("notUsedBadge")}
                    </span>
                  )}

                  {selecting && (
                    <span className="absolute left-2 top-2 flex size-6 items-center justify-center rounded-md border border-white/70 bg-black/40">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-current"
                        checked={isSelected}
                        onChange={() => toggleSelected(asset.id)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={asset.originalFileName || t("untitled")}
                      />
                    </span>
                  )}
                </div>

                {!selecting && (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label={t("deleteLabel", { name: asset.originalFileName || t("untitled") })}
                    onClick={() => setPending(asset)}
                    className="absolute right-2 top-2 size-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}

                <figcaption className="space-y-0.5 p-2">
                  <p className="truncate text-xs font-medium" title={asset.originalFileName}>
                    {asset.originalFileName || t("untitled")}
                  </p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {formatDate(asset.createdAt, locale)}
                    {asset.processingState === "pending" ? ` · ${t("processing")}` : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("usedInPosts", { count: asset.refCount })}
                  </p>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" className="h-7 rounded-full text-[11px]" disabled={loadingMore} onClick={loadMore}>
            {t("loadMore")}
          </Button>
        </div>
      )}

      {selecting && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/95 px-3 py-2 backdrop-blur">
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {bulkState
              ? t("bulk.progress", { done: bulkState.done, total: bulkState.total })
              : t("selection.tally", { count: selectedIds.size, size: formatBytes(selectedBytes, locale) })}
          </span>
          <div className="ms-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-full text-[11px]"
              disabled={Boolean(bulkState)}
              onClick={() => {
                const allLoaded = assets.every((asset) => selectedIds.has(asset.id));
                setSelectedIds(allLoaded ? new Set() : new Set(assets.map((asset) => asset.id)));
              }}
            >
              {assets.length > 0 && assets.every((asset) => selectedIds.has(asset.id))
                ? t("selection.clear")
                : t("selection.selectAll")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 rounded-full text-[11px]"
              disabled={selectedIds.size === 0 || Boolean(bulkState)}
              onClick={() => setConfirmBulk(true)}
            >
              {t("selection.deleteSelected")}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={Boolean(pending)}
        onOpenChange={(open) => { if (!open) setPending(null); }}
        entity="mediaAsset"
        name={pending?.originalFileName || t("untitled")}
        warning={pending ? t("confirmWarning", { size: formatBytes(pending.sizeBytes, locale) }) : undefined}
        onConfirm={handleDelete}
      />

      <ConfirmDeleteDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        entity="mediaAsset"
        name={t("selection.confirmTitleName", {
          count: selectedIds.size,
          size: formatBytes(selectedBytes, locale),
        })}
        warning={t("selection.confirmBody")}
        onConfirm={async () => {
          setConfirmBulk(false);
          await handleBulkDelete();
        }}
      />
    </div>
  );
}
