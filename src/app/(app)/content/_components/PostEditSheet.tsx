"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import ContentEditor from "./ContentEditor";
import PlatformPreview from "@/components/app/PlatformPreview";
import ImageCropDialog from "@/components/app/ImageCropDialog";
import { apiUpload } from "@/lib/api-client";
import { getSocialChannelConfig } from "@/lib/social/channel-catalog";
import { toast } from "sonner";
import { toastApiError } from "@/lib/error-toast";
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
  scheduleLabel,
  title,
}: {
  post: Post | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (content: string, mediaUrls?: string[]) => Promise<void>;
  onSchedule?: (content: string, mediaUrls?: string[]) => void;
  scheduleLabel?: string;
  title?: string;
}) {
  const t = useTranslations("content.postEditSheet");
  const resolvedScheduleLabel = scheduleLabel ?? t("defaultScheduleLabel");
  const resolvedTitle = title ?? t("defaultTitle");
  const [content, setContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  /** Image waiting on the crop dialog; non-empty is what opens it. */
  const [pendingCropFiles, setPendingCropFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load the fields when a different post is opened. Adjusting during render
  // rather than in an effect means the sheet's first frame already shows the
  // right post instead of briefly showing the previous one's text.
  const [loadedPost, setLoadedPost] = useState(post);
  if (post !== loadedPost) {
    setLoadedPost(post);
    if (post) {
      setContent(post.content);
      setMediaUrls(post.mediaUrls ?? []);
    }
  }

  const channel = post?.channel ?? "facebook";
  const currentMedia = mediaUrls[0];
  const allowVideo = channel === "tiktok";

  const handleUpload = async (file: File) => {
    const isVideo = file.type.startsWith("video/");
    if (isVideo && !allowVideo) {
      toast.error(t("toasts.videoTikTokOnly"));
      return;
    }
    // Let the user frame the image before it replaces the post's media, so a
    // swapped-in picture lands in the shape the channel expects.
    if (file.type.startsWith("image/")) {
      setPendingCropFiles([file]);
      return;
    }
    await uploadFile(file);
  };

  const uploadFile = async (file: File) => {
    const isVideo = file.type.startsWith("video/");
    const maxSize = isVideo ? 250 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(isVideo ? t("toasts.videoTooLarge") : t("toasts.imageTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append(isVideo ? "video" : "image", file);
      const res = await apiUpload<{ ok: boolean; url: string }>("/api/media/upload", fd);
      if (res.ok) {
        setMediaUrls([res.data.url]);
        toast.success(isVideo ? t("toasts.videoUploaded") : t("toasts.imageUploaded"));
      } else {
        // Storage quota and subscription rejections both land here, and both
        // are things the user can act on once they are told which it was.
        toastApiError(res.data, t("toasts.uploadFailed"));
      }
    } catch {
      toast.error(t("toasts.uploadFailed"));
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

  // Cmd/Ctrl+Enter saves. Escape already closes the sheet via Radix.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !saving) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="overflow-y-auto sm:max-w-[560px] flex flex-col gap-0 p-0"
        onKeyDown={handleKeyDown}
      >
        <SheetHeader
          className="px-6 pt-6 pb-4 border-b border-border"
        >
          <p className="mk-eyebrow">{channelLabels[channel] ?? channel}</p>
          <SheetTitle
            className="text-[22px] font-semibold m-0 text-foreground"
          >
            {resolvedTitle}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div className="space-y-2">
            <p className="mk-eyebrow">{t("caption")}</p>
            <ContentEditor content={content} onChange={setContent} channel={channel} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="mk-eyebrow">{allowVideo ? t("media") : t("image")}</p>
              {currentMedia && (
                <button
                  onClick={() => setMediaUrls([])}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  {t("remove")}
                </button>
              )}
            </div>

            {currentMedia ? (
              <div className="relative group rounded-xl overflow-hidden border border-border">
                {isVideoUrl(currentMedia) ? (
                  <video src={currentMedia} className="w-full object-cover max-h-56 bg-black" muted playsInline preload="metadata" />
                ) : (
                  <img src={currentMedia} alt="Post image" className="w-full object-cover max-h-56" />
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-white text-[12px] font-medium bg-card hover:bg-card px-3.5 py-1.5 rounded-lg transition-colors"
                  >
                    {t("replace")}
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="cursor-pointer rounded-xl border border-border bg-muted/40 p-8 text-center transition-colors hover:bg-muted"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{allowVideo ? t("dropMedia") : t("dropImage")}</p>
                <p className="text-xs text-muted-foreground/50 mt-1">{allowVideo ? t("mediaHintVideo") : t("mediaHintImage")}</p>
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
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? t("uploading") : t("upload")}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="mk-eyebrow">{t("preview")}</p>
            <PlatformPreview
              content={content}
              channel={channel}
              mediaUrls={currentMedia ? [currentMedia] : undefined}
            />
          </div>
        </div>

        <SheetFooter
          className="px-6 py-4 border-t flex gap-2 border-border"
        >
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          {onSchedule && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onSchedule(content, mediaUrls.length > 0 ? mediaUrls : undefined)}
            >
              {resolvedScheduleLabel}
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
      <ImageCropDialog
        files={pendingCropFiles}
        channels={getSocialChannelConfig(channel) ? [getSocialChannelConfig(channel)!.channel] : []}
        onCancel={() => setPendingCropFiles([])}
        onConfirm={(cropped) => {
          setPendingCropFiles([]);
          if (cropped[0]) void uploadFile(cropped[0]);
        }}
      />
    </Sheet>
  );
}
