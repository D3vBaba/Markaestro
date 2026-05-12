"use client";

import { useState, useRef, useEffect } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import ContentEditor from "./ContentEditor";
import PlatformPreview from "@/components/app/PlatformPreview";
import { apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import { ImagePlus } from "lucide-react";

type Post = {
  id: string;
  content: string;
  channel: string;
  mediaUrls?: string[];
};

const channelLabels: Record<string, string> = {
  x: "X", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok",
};

const isVideoUrl = (url: string) => /\.(mp4|mov|webm)(?:[?&]|$)/i.test(url);

export default function PostEditSheet({
  post,
  open,
  onOpenChange,
  onSave,
  onSchedule,
  title = "Edit Post",
}: {
  post: Post | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (content: string, mediaUrls?: string[]) => Promise<void>;
  onSchedule?: (content: string, mediaUrls?: string[]) => void;
  title?: string;
}) {
  const [content, setContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (post) {
      setContent(post.content);
      setMediaUrls(post.mediaUrls ?? []);
    }
  }, [post]);

  const channel = post?.channel ?? "facebook";
  const currentMedia = mediaUrls[0];
  const allowVideo = channel === "tiktok";

  const handleUpload = async (file: File) => {
    const isVideo = file.type.startsWith("video/");
    if (isVideo && !allowVideo) {
      toast.error("Videos are available for TikTok posts only");
      return;
    }
    const maxSize = isVideo ? 250 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(isVideo ? "Video must be under 250 MB" : "Image must be under 10 MB");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append(isVideo ? "video" : "image", file);
      const res = await apiUpload<{ ok: boolean; url: string }>("/api/media/upload", fd);
      if (res.ok) {
        setMediaUrls([res.data.url]);
        toast.success(isVideo ? "Video uploaded" : "Image uploaded");
      } else {
        toast.error("Upload failed");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(content, mediaUrls.length > 0 ? mediaUrls : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-[560px] flex flex-col gap-0 p-0">
        <SheetHeader
          className="px-6 pt-6 pb-4 border-b"
          style={{ borderColor: "var(--mk-rule)" }}
        >
          <p className="mk-eyebrow">{channelLabels[channel] ?? channel}</p>
          <SheetTitle
            className="text-[22px] font-semibold m-0"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.025em" }}
          >
            {title}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div className="space-y-2">
            <p className="mk-eyebrow">Caption</p>
            <ContentEditor content={content} onChange={setContent} channel={channel} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="mk-eyebrow">{allowVideo ? "Media" : "Image"}</p>
              {currentMedia && (
                <button
                  onClick={() => setMediaUrls([])}
                  className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                >
                  Remove
                </button>
              )}
            </div>

            {currentMedia ? (
              <div className="relative group rounded-xl overflow-hidden border border-border/40">
                {isVideoUrl(currentMedia) ? (
                  <video src={currentMedia} className="w-full object-cover max-h-56 bg-black" muted playsInline preload="metadata" />
                ) : (
                  <img src={currentMedia} alt="Post image" className="w-full object-cover max-h-56" />
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-white text-[12px] font-medium bg-white/20 hover:bg-white/30 px-3.5 py-1.5 rounded-lg transition-colors"
                  >
                    Replace
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-border/50 hover:border-foreground/30 rounded-xl p-8 text-center cursor-pointer transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{allowVideo ? "Drop media or click to upload" : "Drop an image or click to upload"}</p>
                <p className="text-[11px] text-muted-foreground/50 mt-1">{allowVideo ? "MP4/MOV/WebM ≤250 MB · JPG/PNG ≤10 MB" : "JPG, PNG, WebP · up to 10 MB"}</p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={allowVideo ? "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" : "image/png,image/jpeg,image/webp"}
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
            />

            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="mk-eyebrow">Preview</p>
            <PlatformPreview
              content={content}
              channel={channel}
              mediaUrls={currentMedia ? [currentMedia] : undefined}
            />
          </div>
        </div>

        <SheetFooter
          className="px-6 py-4 border-t flex gap-2"
          style={{ borderColor: "var(--mk-rule)" }}
        >
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-9 rounded-lg text-[13px]"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {onSchedule && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-9 rounded-lg text-[13px]"
              onClick={() => onSchedule(content, mediaUrls.length > 0 ? mediaUrls : undefined)}
            >
              Schedule
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1 h-9 rounded-lg text-[13px]"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
