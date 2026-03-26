"use client";

import { useEffect, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiDelete } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Trash2, X } from "lucide-react";

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
    if (!confirm("Delete this file?")) return;
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
    if (!confirm(`Delete ${selected.size} file${selected.size > 1 ? "s" : ""}?`)) return;
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
                onClick={handleDeleteSelected}
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
              {isVideo(img) ? (
                <video
                  src={img.url}
                  className="w-full aspect-square object-cover"
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <a
                  href={selectMode ? undefined : img.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={selectMode ? "" : "cursor-zoom-in"}
                  onClick={selectMode ? (e) => e.preventDefault() : undefined}
                >
                  <img
                    src={img.url}
                    alt={img.name}
                    className="w-full aspect-square object-cover hover:opacity-90 transition-opacity"
                    loading="lazy"
                  />
                </a>
              )}

              {/* Badges */}
              <div className="absolute top-2 left-2 flex items-center gap-1.5">
                {isVideo(img) && (
                  <span className="px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium pointer-events-none">
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

              {/* Hover overlay — hidden in select mode */}
              {!selectMode && (
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-start justify-end p-4">
                  <p className="text-white text-[11px] truncate w-full mb-1">
                    {img.name}
                  </p>
                  <p className="text-white/50 text-[10px] mb-3">
                    {new Date(img.createdAt).toLocaleDateString()}
                    {" / "}
                    {img.size >= 1024 * 1024
                      ? `${(img.size / (1024 * 1024)).toFixed(1)} MB`
                      : `${(img.size / 1024).toFixed(0)} KB`}
                  </p>
                  <div className="flex gap-2 w-full">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-[11px] flex-1"
                      onClick={() => handleCopyUrl(img.url)}
                    >
                      {copiedUrl === img.url ? "Copied" : "Copy URL"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-[11px]"
                      onClick={() => handleDownload(img.url, img.name)}
                    >
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-[11px] px-2"
                      onClick={() => handleDeleteSingle(img.name)}
                      disabled={deleting}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
