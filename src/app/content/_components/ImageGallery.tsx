"use client";

import { useEffect, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiDelete } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Download, ImageIcon, Play, Trash2, Video, X } from "lucide-react";

type GalleryItem = {
  name: string;
  url: string;
  createdAt: string;
  size: number;
  contentType: string;
};

export default function ImageGallery({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "single" | "batch"; name?: string } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    apiGet<{ images: GalleryItem[] }>("/api/ai/images").then((res) => {
      if (res.ok) setItems(res.data.images);
      setLoading(false);
    });
  }, [refreshKey]);

  const isVideo = (item: GalleryItem) =>
    item.contentType?.startsWith("video/") || /\.(mp4|mov|webm)(?:\?|$)/i.test(item.name);

  const formatSize = (size: number) => {
    if (!Number.isFinite(size) || size <= 0) return "";
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  };

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const handleDownload = (url: string, name: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.target = "_blank";
    a.click();
  };

  // ── Selection ────────────────────────────────────────────────

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = () => {
    setSelected(new Set(items.map((i) => i.name)));
  };

  const clearSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
  };

  // ── Delete ───────────────────────────────────────────────────

  const handleDeleteSingle = async (name: string) => {
    setDeleting(true);
    try {
      const res = await apiDelete<{ ok: boolean; deleted: number }>("/api/ai/images", {
        names: [name],
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.name !== name));
        toast.success("Deleted");
      } else {
        toast.error("Delete failed");
      }
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const names = Array.from(selected);
      const res = await apiDelete<{ ok: boolean; deleted: number }>("/api/ai/images", {
        names,
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => !selected.has(i.name)));
        toast.success(`Deleted ${res.data.deleted} file${res.data.deleted > 1 ? "s" : ""}`);
        clearSelection();
      } else {
        toast.error("Delete failed");
      }
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const confirmImageDelete = async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "single" && deleteConfirm.name) {
      await handleDeleteSingle(deleteConfirm.name);
    } else {
      await handleDeleteSelected();
    }
  };

  // ── Lightbox ────────────────────────────────────────────────

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  const goNext = useCallback(() => {
    setLightboxIndex((prev) => (prev !== null ? (prev + 1) % items.length : null));
  }, [items.length]);

  const goPrev = useCallback(() => {
    setLightboxIndex((prev) => (prev !== null ? (prev - 1 + items.length) % items.length : null));
  }, [items.length]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightboxIndex, goNext, goPrev]);

  // ── Loading ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">No media generated yet</p>
        <p className="text-xs text-muted-foreground/60 mt-2">
          Generate images or videos to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {items.length} asset{items.length !== 1 ? "s" : ""}
          {selected.size > 0 && ` · ${selected.size} selected`}
        </p>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={selected.size === items.length ? clearSelection : selectAll}
              >
                {selected.size === items.length ? "Deselect All" : "Select All"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setDeleteConfirm({ type: "batch" })}
                disabled={selected.size === 0 || deleting}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {deleting ? "Deleting..." : `Delete (${selected.size})`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={clearSelection}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setSelectMode(true)}
            >
              Select
            </Button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((img, index) => {
          const isSelected = selected.has(img.name);
          const video = isVideo(img);
          const size = formatSize(img.size);
          return (
            <div
              key={img.name}
              className={`group relative aspect-square overflow-hidden rounded-xl border bg-muted/30 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                isSelected
                  ? "border-foreground ring-2 ring-foreground/15"
                  : "border-border/50 hover:border-foreground/25"
              }`}
              onClick={selectMode ? () => toggleSelect(img.name) : undefined}
            >
              {/* Thumbnail */}
              {video ? (
                <video
                  src={img.url}
                  className="h-full w-full object-cover cursor-pointer"
                  playsInline
                  muted
                  preload="metadata"
                  onClick={selectMode ? undefined : () => openLightbox(index)}
                />
              ) : (
                <img
                  src={img.url}
                  alt=""
                  className="h-full w-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                  onClick={selectMode ? undefined : () => openLightbox(index)}
                />
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent opacity-75 transition-opacity group-hover:opacity-95" />

              <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur">
                {video ? <Video className="size-3" /> : <ImageIcon className="size-3" />}
                {video ? "Video" : "Image"}
              </div>

              {video && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur transition-transform group-hover:scale-105">
                    <Play className="ml-0.5 size-4 fill-current" />
                  </span>
                </div>
              )}

              <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 text-[11px] text-white">
                <span className="rounded-full bg-black/45 px-2 py-1 font-medium backdrop-blur">
                  {formatDate(img.createdAt)}
                </span>
                {size && <span className="rounded-full bg-black/45 px-2 py-1 backdrop-blur">{size}</span>}
              </div>

              {/* Selection checkbox */}
              {selectMode && (
                <div className="absolute top-2 right-2">
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all cursor-pointer ${
                      isSelected
                        ? "bg-foreground border-foreground"
                        : "bg-black/30 border-white/60 hover:border-white"
                    }`}
                  >
                    {isSelected && (
                      <Check className="w-3 h-3 text-background" />
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && items[lightboxIndex] && (() => {
        const item = items[lightboxIndex];
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={closeLightbox}
          >
            {/* Close */}
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-4 right-4 text-white hover:bg-white/10 z-10"
              onClick={closeLightbox}
            >
              <X className="w-5 h-5" />
            </Button>

            {/* Prev / Next arrows */}
            {items.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 z-10"
                  onClick={(e) => { e.stopPropagation(); goPrev(); }}
                >
                  <ChevronLeft className="w-6 h-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 z-10"
                  onClick={(e) => { e.stopPropagation(); goNext(); }}
                >
                  <ChevronRight className="w-6 h-6" />
                </Button>
              </>
            )}

            {/* Media */}
            <div
              className="flex flex-col items-center gap-4 max-w-[90vw] max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {isVideo(item) ? (
                <video
                  key={item.url}
                  src={item.url}
                  className="max-w-full max-h-[75vh] rounded-lg"
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <img
                  src={item.url}
                  alt={item.name}
                  className="max-w-full max-h-[75vh] rounded-lg object-contain"
                />
              )}

              {/* Info + actions */}
              <div className="flex items-center gap-3 rounded-xl bg-black/60 px-4 py-2 backdrop-blur">
                <span className="flex items-center gap-1.5 text-white text-xs font-medium">
                  {isVideo(item) ? <Video className="size-3.5" /> : <ImageIcon className="size-3.5" />}
                  {isVideo(item) ? "Video" : "Image"}
                </span>
                <span className="text-white/55 text-[10px]">
                  {formatDate(item.createdAt)}
                  {formatSize(item.size) ? ` · ${formatSize(item.size)}` : ""}
                </span>
                <div className="flex gap-1.5 ml-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[11px] gap-1.5"
                    onClick={() => handleDownload(item.url, item.name)}
                  >
                    <Download className="w-3 h-3" />
                    Download
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-[11px] px-2"
                    onClick={() => {
                      setDeleteConfirm({ type: "single", name: item.name });
                      closeLightbox();
                    }}
                    disabled={deleting}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <ConfirmDeleteDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}
        entity={deleteConfirm?.type === "batch" ? `${selected.size} asset${selected.size !== 1 ? "s" : ""}` : "asset"}
        onConfirm={confirmImageDelete}
      />
    </div>
  );
}
