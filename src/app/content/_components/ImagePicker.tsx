"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import { Check, ImageIcon, Play, Upload, Video } from "lucide-react";

type GalleryMedia = {
  name: string;
  url: string;
  createdAt: string;
  size: number;
  contentType?: string;
};

export default function ImagePicker({
  open,
  onOpenChange,
  onSelect,
  allowVideos = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (url: string) => void;
  allowVideos?: boolean;
}) {
  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isVideo = (item: GalleryMedia) =>
    item.contentType?.startsWith("video/") || /\.(mp4|mov|webm)(?:\?|$)/i.test(item.name);

  const visibleMedia = allowVideos ? media : media.filter((item) => !isVideo(item));

  const formatSize = (size: number) => {
    if (!Number.isFinite(size) || size <= 0) return "";
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  };

  const fetchImages = () => {
    setLoading(true);
    setSelected(null);
    apiGet<{ images: GalleryMedia[] }>("/api/ai/images").then((res) => {
      if (res.ok) setMedia(res.data.images);
      setLoading(false);
    });
  };

  useEffect(() => {
    if (open) fetchImages();
  }, [open]);

  const handleUpload = async (file: File) => {
    const isUploadVideo = file.type.startsWith("video/");
    if (isUploadVideo && !allowVideos) {
      toast.error("Videos are available for TikTok posts only");
      return;
    }
    const maxSize = isUploadVideo ? 250 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(isUploadVideo ? "Video must be under 250 MB" : "Image must be under 10 MB");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append(isUploadVideo ? "video" : "image", file);
      const res = await apiUpload<{ ok: boolean; url: string }>("/api/ai/images", fd);
      if (res.ok) {
        toast.success(isUploadVideo ? "Video uploaded" : "Image uploaded");
        fetchImages();
        setSelected(res.data.url);
      } else {
        toast.error("Upload failed");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = () => {
    if (selected) {
      onSelect(selected);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[84vh] flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4 border-b border-border/50 px-6 py-4">
            <div>
              <DialogTitle>{allowVideos ? "Media Gallery" : "Image Gallery"}</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {visibleMedia.length} {allowVideos ? "asset" : "image"}{visibleMedia.length === 1 ? "" : "s"} available
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={allowVideos ? "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" : "image/png,image/jpeg,image/webp"}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
              />
              <Button
                variant="outline"
                size="sm"
                className="text-xs flex items-center gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? "Uploading…" : allowVideos ? "Upload Media" : "Upload Image"}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-xl" />
              ))}
            </div>
          ) : visibleMedia.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 text-center">
              <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-background border border-border/70">
                {allowVideos ? <Video className="size-4 text-muted-foreground" /> : <ImageIcon className="size-4 text-muted-foreground" />}
              </div>
              <p className="text-sm font-medium text-foreground">{allowVideos ? "No media yet" : "No images yet"}</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {allowVideos ? "Upload an image or video, or generate visuals in the Create tab." : "Upload an image or generate one in the Create tab."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {visibleMedia.map((img) => {
                const video = isVideo(img);
                const picked = selected === img.url;
                const size = formatSize(img.size);
                return (
                <button
                  key={img.name}
                  onClick={() => setSelected(img.url)}
                  className={`group relative aspect-square overflow-hidden rounded-xl border bg-muted/30 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                    picked
                      ? "border-foreground ring-2 ring-foreground/10"
                      : "border-border/60 hover:border-foreground/30"
                  }`}
                  aria-label={`Select ${video ? "video" : "image"}`}
                >
                  {video ? (
                    <video
                      src={img.url}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={img.url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-80 transition-opacity group-hover:opacity-95" />
                  <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur">
                    {video ? <Video className="size-3" /> : <ImageIcon className="size-3" />}
                    {video ? "Video" : "Image"}
                  </div>
                  {video && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-10 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur transition-transform group-hover:scale-105">
                        <Play className="ml-0.5 size-4 fill-current" />
                      </span>
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 text-[11px] text-white">
                    <span className="rounded-full bg-black/45 px-2 py-1 font-medium backdrop-blur">
                      {new Date(img.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                    {size && <span className="rounded-full bg-black/45 px-2 py-1 backdrop-blur">{size}</span>}
                  </div>
                  {picked && (
                    <div className="absolute inset-0 border-2 border-foreground rounded-xl">
                      <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-foreground text-background shadow-lg">
                        <Check className="size-4" />
                      </span>
                    </div>
                  )}
                </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border/50 px-6 py-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!selected}>
            Use Selected
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
