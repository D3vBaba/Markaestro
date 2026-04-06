"use client";

import { useEffect, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiDelete } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { toast } from "sonner";
import { Trash2, X, Download, Link, ChevronLeft, ChevronRight } from "lucide-react";

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
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
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
    item.contentType?.startsWith("video/") || item.name.endsWith(".mp4");

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    toast.success("URL copied");
    setTimeout(() => setCopiedUrl(null), 2000);
  };

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
          {items.length} file{items.length !== 1 ? "s" : ""}
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
        {items.map((img) => {
          const isSelected = selected.has(img.name);
          return (
            <div
              key={img.name}
              className={`group relative overflow-hidden rounded-lg border transition-all ${
                isSelected
                  ? "border-foreground ring-2 ring-foreground/20"
                  : "border-border/40"
              }`}
              onClick={selectMode ? () => toggleSelect(img.name) : undefined}
            >
              {/* Thumbnail */}
              {isVideo(img) ? (
                <video
                  src={img.url}
                  className="w-full aspect-video object-contain bg-black cursor-pointer"
                  playsInline
                  muted
                  preload="metadata"
                  onClick={selectMode ? undefined : () => openLightbox(items.indexOf(img))}
                />
              ) : (
                <img
                  src={img.url}
                  alt={img.name}
                  className="w-full aspect-square object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  loading="lazy"
                  onClick={selectMode ? undefined : () => openLightbox(items.indexOf(img))}
                />
              )}

              {/* Badges */}
              <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
                {isVideo(img) && (
                  <span className="px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">
                    VIDEO
                  </span>
                )}
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
                      <svg className="w-3 h-3 text-background" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
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
              <div className="flex items-center gap-3 bg-black/60 rounded-lg px-4 py-2">
                <p className="text-white text-xs truncate max-w-50">{item.name}</p>
                <span className="text-white/40 text-[10px]">
                  {new Date(item.createdAt).toLocaleDateString()}
                  {" · "}
                  {item.size >= 1024 * 1024
                    ? `${(item.size / (1024 * 1024)).toFixed(1)} MB`
                    : `${(item.size / 1024).toFixed(0)} KB`}
                </span>
                <div className="flex gap-1.5 ml-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[11px] gap-1.5"
                    onClick={() => handleCopyUrl(item.url)}
                  >
                    <Link className="w-3 h-3" />
                    {copiedUrl === item.url ? "Copied" : "Copy URL"}
                  </Button>
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
        entity={deleteConfirm?.type === "batch" ? `${selected.size} image${selected.size !== 1 ? "s" : ""}` : "image"}
        onConfirm={confirmImageDelete}
      />
    </div>
  );
}
