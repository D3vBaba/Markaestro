"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, apiPut, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import ChannelSelector from "./ChannelSelector";
import ContentEditor from "./ContentEditor";
import ScheduleSheet from "./ScheduleSheet";
import PlatformPreview from "@/components/app/PlatformPreview";

const MAX_MEDIA = 6;
const isVideoUrl = (url: string) => /\.(mp4|mov|webm)(?:[?&]|$)/i.test(url);

export default function CreateTab({
  productId,
  onPostCreated,
}: {
  productId: string;
  onProductChange?: (id: string) => void;
  onPostCreated?: () => void;
}) {
  const [channel, setChannel] = useState("facebook");
  const [content, setContent] = useState("");
  const [postId, setPostId] = useState<string | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["facebook"]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll a just-published post until it reaches a terminal state so the
  // card elsewhere in the app transitions out of `publishing` without
  // needing a manual refresh.
  const activePollRef = useRef<{ postId: string; cancelled: boolean } | null>(null);
  useEffect(() => () => { if (activePollRef.current) activePollRef.current.cancelled = true; }, []);

  const startStatusPolling = (targetPostId: string) => {
    if (activePollRef.current) activePollRef.current.cancelled = true;
    const handle = { postId: targetPostId, cancelled: false };
    activePollRef.current = handle;

    const INTERVAL_MS = 10_000;
    const MAX_ATTEMPTS = 12;
    const TERMINAL = new Set(["exported_for_review", "published", "failed"]);

    let attempt = 0;
    const tick = async () => {
      if (handle.cancelled) return;
      attempt += 1;
      try {
        const res = await apiGet<{ status?: string }>(`/api/posts/${targetPostId}`);
        if (handle.cancelled) return;
        const status = res.ok ? res.data.status : undefined;
        onPostCreated?.();
        if (status && TERMINAL.has(status)) {
          if (activePollRef.current === handle) activePollRef.current = null;
          return;
        }
      } catch { /* transient */ }
      if (attempt >= MAX_ATTEMPTS) {
        if (activePollRef.current === handle) activePollRef.current = null;
        return;
      }
      setTimeout(tick, INTERVAL_MS);
    };
    setTimeout(tick, INTERVAL_MS);
  };

  const handleChannelChange = (ch: string) => {
    setChannel(ch);
  };

  const handleSelectedChannelsChange = (channels: string[]) => {
    const normalized = Array.from(new Set(channels)).filter(Boolean);
    const next = normalized.length > 0 ? normalized : [channel];
    setSelectedChannels(next);
    if (!next.includes(channel)) {
      handleChannelChange(next[0]);
    }
  };

  const getPostTargets = () => {
    const normalized = selectedChannels.length > 0 ? selectedChannels : [channel];
    return Array.from(new Set(normalized)).filter(Boolean);
  };

  const buildPostPayload = (urls?: string[]) => {
    const targetChannels = getPostTargets();
    const primaryChannel = targetChannels[0] || channel;
    return {
      content,
      channel: primaryChannel,
      productId,
      targetChannels,
      mediaUrls: urls,
    };
  };

  const handleUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const containsVideo = files.some((f) => f.type.startsWith("video/"));
    if (containsVideo && files.length > 1) {
      toast.error("Videos must be uploaded on their own");
      return;
    }

    const available = MAX_MEDIA - mediaUrls.length;
    if (available <= 0) {
      toast.error(`Maximum ${MAX_MEDIA} media items`);
      return;
    }
    const filesToUpload = files.slice(0, available);

    setUploading(true);
    try {
      const results = await Promise.all(
        filesToUpload.map(async (file) => {
          const isVideo = file.type.startsWith("video/");
          const maxSize = isVideo ? 250 * 1024 * 1024 : 10 * 1024 * 1024;
          if (file.size > maxSize) {
            toast.error(`${file.name}: must be under ${isVideo ? "250" : "10"} MB`);
            return null;
          }
          const fd = new FormData();
          fd.append(isVideo ? "video" : "image", file);
          const res = await apiUpload<{ ok: boolean; url: string }>("/api/media/upload", fd);
          if (!res.ok) {
            toast.error(`${file.name}: upload failed`);
            return null;
          }
          return res.data.url;
        }),
      );
      const uploaded = results.filter((u): u is string => !!u);
      if (uploaded.length > 0) {
        setMediaUrls((prev) => [...prev, ...uploaded].slice(0, MAX_MEDIA));
        toast.success(`${uploaded.length} file${uploaded.length > 1 ? "s" : ""} uploaded`);
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const ensurePostId = async (): Promise<string | null> => {
    if (postId) return postId;
    const urls = mediaUrls.length > 0 ? mediaUrls : undefined;
    const res = await apiPost<{ id: string }>("/api/posts", {
      ...buildPostPayload(urls),
      status: "draft",
    });
    if (res.ok) {
      setPostId(res.data.id);
      return res.data.id;
    }
    toast.error("Failed to create post");
    return null;
  };

  const handleSaveDraft = async () => {
    if (!content) return;
    const urls = mediaUrls.length > 0 ? mediaUrls : undefined;
    if (postId) {
      const res = await apiPut(`/api/posts/${postId}`, buildPostPayload(urls));
      if (res.ok) { toast.success("Draft saved"); onPostCreated?.(); }
      else toast.error("Failed to save draft");
    } else {
      const id = await ensurePostId();
      if (id) { toast.success("Draft saved"); onPostCreated?.(); }
    }
  };

  const handleSchedule = async (scheduledAt: string) => {
    if (!content) return;
    const urls = mediaUrls.length > 0 ? mediaUrls : undefined;
    const id = postId ?? await ensurePostId();
    if (!id) return;
    const res = await apiPut(`/api/posts/${id}`, {
      ...buildPostPayload(urls),
      status: "scheduled",
      scheduledAt,
    });
    if (res.ok) {
      toast.success("Post scheduled");
      setContent("");
      setPostId(null);
      setMediaUrls([]);
      onPostCreated?.();
    } else {
      toast.error("Failed to schedule post");
    }
  };

  const handlePostNow = async () => {
    if (!content) return;
    setPublishing(true);
    const urls = mediaUrls.length > 0 ? mediaUrls : undefined;
    const id = postId ?? await ensurePostId();
    if (!id) { setPublishing(false); return; }
    await apiPut(`/api/posts/${id}`, buildPostPayload(urls));
    const res = await apiPost<{
      ok: boolean;
      status?: string;
      pending?: boolean;
      error?: string;
      externalUrl?: string;
      channels?: Array<{ channel: string; success: boolean; externalUrl?: string; error?: string }>;
    }>(`/api/posts/${id}/publish`, {});
    if (res.ok && res.data.ok) {
      const channels = res.data.channels || [];
      const successful = channels.filter((c) => c.success);
      const failed = channels.filter((c) => !c.success && !c.error?.startsWith("Skipped"));
      const hasTikTok = channels.some((c) => c.channel === "tiktok");

      if (res.data.status === "publishing" || res.data.pending) {
        if (hasTikTok) {
          toast.success("Sending to TikTok. Markaestro is waiting for TikTok to confirm inbox delivery.");
        } else {
          toast.success("Post submitted and still processing.");
        }
        setContent("");
        setPostId(null);
        setMediaUrls([]);
        onPostCreated?.();
        startStatusPolling(id);
        setPublishing(false);
        return;
      }

      if (res.data.status === "exported_for_review") {
        toast.success("TikTok confirmed inbox delivery. Open TikTok Inbox, finish the caption, and tap Post.");
        setContent("");
        setPostId(null);
        setMediaUrls([]);
        onPostCreated?.();
        setPublishing(false);
        return;
      }

      if (successful.length > 1) {
        toast.success(`Posted to ${successful.map((c) => c.channel).join(" & ")}!`);
      } else if (hasTikTok) {
        toast.success("TikTok confirmed inbox delivery. Open TikTok Inbox, finish the caption, and tap Post.");
      } else {
        toast.success("Posted successfully!");
      }

      for (const ch of successful) {
        if (ch.externalUrl) toast.info(`${ch.channel}: ${ch.externalUrl}`);
      }
      for (const ch of failed) {
        toast.error(`${ch.channel}: ${ch.error}`);
      }

      setContent("");
      setPostId(null);
      setMediaUrls([]);
      onPostCreated?.();
    } else {
      toast.error(res.data.error || "Publishing failed");
    }
    setPublishing(false);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Left column — inputs */}
      <div className="space-y-6">
        <ChannelSelector
          value={channel}
          onChange={handleChannelChange}
          productId={productId}
          selectedChannels={selectedChannels}
          onSelectedChannelsChange={handleSelectedChannelsChange}
        />

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Caption</label>
          <ContentEditor content={content} onChange={setContent} channel={channel} channels={selectedChannels} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Media</label>
            <span className="text-[11px] text-muted-foreground">{mediaUrls.length}/{MAX_MEDIA}</span>
          </div>
          {mediaUrls.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {mediaUrls.map((url, i) => (
                <div key={`${url}-${i}`} className="relative group aspect-square rounded-lg overflow-hidden border border-border/40">
                  {isVideoUrl(url) ? (
                    <video src={url} className="w-full h-full object-cover" />
                  ) : (
                    <img src={url} alt={`Media ${i + 1}`} className="w-full h-full object-cover" />
                  )}
                  <button
                    onClick={() => setMediaUrls((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
              {mediaUrls.length < MAX_MEDIA && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-border/50 hover:border-foreground/30 text-xs text-muted-foreground"
                >
                  + Add
                </button>
              )}
            </div>
          ) : (
            <div
              className="border-2 border-dashed border-border/50 hover:border-foreground/30 rounded-xl p-8 text-center cursor-pointer transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <p className="text-sm text-muted-foreground">{channel === "tiktok" ? "Drop videos or images" : "Drop images or click to upload"}</p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">Up to {MAX_MEDIA} items · {channel === "tiktok" ? "MP4/MOV/WebM ≤250 MB · JPG/PNG ≤10 MB" : "JPG, PNG, WebP · up to 10 MB"}</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={channel === "tiktok" ? "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" : "image/png,image/jpeg,image/webp"}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) handleUpload(files);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => fileInputRef.current?.click()} disabled={uploading || mediaUrls.length >= MAX_MEDIA}>
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2">
          <Button variant="outline" onClick={handleSaveDraft} disabled={!content} className="h-11 sm:h-9 text-xs sm:text-sm">
            Save Draft
          </Button>
          <Button variant="outline" onClick={() => setScheduleOpen(true)} disabled={!content} className="h-11 sm:h-9 text-xs sm:text-sm">
            Schedule
          </Button>
          <Button onClick={handlePostNow} disabled={publishing || !content} className="h-11 sm:h-9 text-xs sm:text-sm">
            {publishing ? "Posting…" : "Post Now"}
          </Button>
        </div>
      </div>

      {/* Right column — preview */}
      <div className="border border-border/40 rounded-lg p-4 sm:p-6 space-y-6 h-fit lg:sticky lg:top-20 bg-card">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</h3>
        {content ? (
          <PlatformPreview content={content} channel={channel} mediaUrls={mediaUrls.length > 0 ? mediaUrls : undefined} />
        ) : (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">Your post preview will appear here.</p>
            <p className="text-xs text-muted-foreground/60 mt-2">Write a caption and upload your media to get started.</p>
          </div>
        )}
      </div>

      <ScheduleSheet open={scheduleOpen} onOpenChange={setScheduleOpen} onSchedule={handleSchedule} channel={channel} />
    </div>
  );
}
