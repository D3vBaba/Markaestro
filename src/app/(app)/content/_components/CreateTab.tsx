"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, apiPut, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import ChannelSelector from "./ChannelSelector";
import ContentEditor from "./ContentEditor";
import ScheduleSheet from "./ScheduleSheet";
import PlatformPreview from "@/components/app/PlatformPreview";
import { getSocialChannelConfig, getSocialChannelLabel } from "@/lib/social/channel-catalog";
import { getSharedMediaLimit, validateSocialPost } from "@/lib/social/post-validation";
import type { SocialChannel } from "@/lib/schemas";
import { isPlatformActionRequiredStatus, LEGACY_EXPORTED_FOR_REVIEW_STATUS, PLATFORM_ACTION_REQUIRED_STATUS } from "@/lib/tiktok-draft-flow";

const DRAFT_STORAGE_PREFIX = "markaestro_post_draft";
const isVideoUrl = (url: string) => /\.(mp4|mov|webm)(?:[?&]|$)/i.test(url);

type StoredDraft = {
  content: string;
  selectedChannels: string[];
  channel: string;
  mediaUrls: string[];
};

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
  const [previewChannel, setPreviewChannel] = useState("facebook");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Draft safety (autosave-lite) ──────────────────────────────────────────
  // Persist the in-progress draft locally so a reload/crash doesn't lose work.
  const draftKey = `${DRAFT_STORAGE_PREFIX}_${productId || "default"}`;
  const restoredRef = useRef(false);

  const clearStoredDraft = () => {
    if (typeof window !== "undefined") localStorage.removeItem(draftKey);
  };

  // Restore an unsaved draft once the product context is known
  useEffect(() => {
    if (restoredRef.current || !productId || typeof window === "undefined") return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as StoredDraft;
      if (!saved.content || content) return;
      setContent(saved.content);
      if (saved.selectedChannels?.length) setSelectedChannels(saved.selectedChannels);
      if (saved.channel) setChannel(saved.channel);
      if (saved.mediaUrls?.length) setMediaUrls(saved.mediaUrls);
      toast.info("Restored your unsaved draft", {
        action: {
          label: "Discard",
          onClick: () => {
            localStorage.removeItem(draftKey);
            setContent("");
            setMediaUrls([]);
          },
        },
      });
    } catch { /* corrupt entry — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, productId]);

  // Save on a 1s debounce. Once the draft exists server-side (postId set)
  // the local copy is redundant, so drop it. Never auto-creates server drafts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = setTimeout(() => {
      if (!content || postId) {
        localStorage.removeItem(draftKey);
        return;
      }
      const draft: StoredDraft = { content, selectedChannels, channel, mediaUrls };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    }, 1000);
    return () => clearTimeout(handle);
  }, [content, selectedChannels, channel, mediaUrls, postId, draftKey]);

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
    const TERMINAL = new Set([PLATFORM_ACTION_REQUIRED_STATUS, LEGACY_EXPORTED_FOR_REVIEW_STATUS, "published", "failed", "partial_failed"]);

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

  const getTypedPostTargets = (): SocialChannel[] => (
    getPostTargets().filter((item): item is SocialChannel => Boolean(getSocialChannelConfig(item)))
  );

  const getMediaLimit = () => {
    const limit = getSharedMediaLimit(getTypedPostTargets());
    return Number.isFinite(limit) && limit > 0 ? limit : 1;
  };

  const selectedChannelsAllowVideo = () => getTypedPostTargets().every((target) => {
    const config = getSocialChannelConfig(target);
    return config?.mediaKinds.includes("video");
  });

  const validateCurrentPost = (urls = mediaUrls) => {
    const issues = validateSocialPost({
      content,
      channel,
      targetChannels: getTypedPostTargets(),
      mediaUrls: urls,
    });
    if (issues.length > 0) {
      toast.error(issues[0].message);
      return false;
    }
    return true;
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
    if (containsVideo && !selectedChannelsAllowVideo()) {
      toast.error("One or more selected channels does not support video uploads");
      return;
    }
    if (containsVideo && files.length > 1) {
      toast.error("Videos must be uploaded on their own");
      return;
    }

    const maxMedia = getMediaLimit();
    const available = maxMedia - mediaUrls.length;
    if (available <= 0) {
      toast.error(`Maximum ${maxMedia} media item${maxMedia === 1 ? "" : "s"} for the selected channels`);
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
        setMediaUrls((prev) => [...prev, ...uploaded].slice(0, maxMedia));
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
      if (res.ok) { toast.success("Draft saved"); clearStoredDraft(); onPostCreated?.(); }
      else toast.error("Failed to save draft");
    } else {
      const id = await ensurePostId();
      if (id) { toast.success("Draft saved"); clearStoredDraft(); onPostCreated?.(); }
    }
  };

  const handleSchedule = async (scheduledAt: string) => {
    if (!content) return;
    if (!validateCurrentPost()) return;
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
      clearStoredDraft();
      onPostCreated?.();
    } else {
      toast.error("Failed to schedule post");
    }
  };

  const handlePostNow = async () => {
    if (!content) return;
    if (!validateCurrentPost()) return;
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
        clearStoredDraft();
        onPostCreated?.();
        startStatusPolling(id);
        setPublishing(false);
        return;
      }

      if (isPlatformActionRequiredStatus(res.data.status)) {
        toast.success("TikTok confirmed inbox delivery. Open TikTok Inbox, finish the caption, and tap Post.");
        setContent("");
        setPostId(null);
        setMediaUrls([]);
        clearStoredDraft();
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
      clearStoredDraft();
      onPostCreated?.();
    } else {
      toast.error(res.data.error || "Publishing failed");
    }
    setPublishing(false);
  };

  // Cmd/Ctrl+Enter: Post Now when ready, otherwise save a draft.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
    if (!content || publishing) return;
    e.preventDefault();
    if (uploading) {
      handleSaveDraft();
    } else {
      handlePostNow();
    }
  };

  // Which platform the preview renders — falls back to the primary channel
  // when the previously previewed channel is deselected.
  const activePreviewChannel = selectedChannels.includes(previewChannel) ? previewChannel : channel;
  const mediaLimit = getMediaLimit();
  const allowVideo = selectedChannelsAllowVideo();

  return (
    <div className="grid gap-8 lg:grid-cols-2" onKeyDown={handleKeyDown}>
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
            <span className="text-[11px] text-muted-foreground">{mediaUrls.length}/{mediaLimit}</span>
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
              {mediaUrls.length < mediaLimit && (
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
              <p className="text-sm text-muted-foreground">{allowVideo ? "Drop images or videos" : "Drop images or click to upload"}</p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">Up to {mediaLimit} item{mediaLimit === 1 ? "" : "s"} · {allowVideo ? "MP4/MOV/WebM ≤250 MB · JPG/PNG/WebP ≤10 MB" : "JPG, PNG, WebP · up to 10 MB"}</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={allowVideo ? "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" : "image/png,image/jpeg,image/webp"}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) handleUpload(files);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => fileInputRef.current?.click()} disabled={uploading || mediaUrls.length >= mediaLimit}>
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
        {selectedChannels.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedChannels.map((ch) => (
              <button
                key={ch}
                onClick={() => setPreviewChannel(ch)}
                className={`px-3 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                  activePreviewChannel === ch
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                }`}
              >
                {getSocialChannelLabel(ch)}
              </button>
            ))}
          </div>
        )}
        {content ? (
          <PlatformPreview content={content} channel={activePreviewChannel} mediaUrls={mediaUrls.length > 0 ? mediaUrls : undefined} />
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
