"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, apiPut, apiUpload } from "@/lib/api-client";
import { deferFromEffect } from "@/lib/defer-from-effect";
import { toast } from "sonner";
import ChannelSelector from "./ChannelSelector";
import ContentEditor from "./ContentEditor";
import ScheduleSheet from "./ScheduleSheet";
import TikTokDirectPostPanel, { type TikTokCreatorInfoState } from "./TikTokDirectPostPanel";
import PlatformPreview from "@/components/app/PlatformPreview";
import { Label } from "@/components/ui/label";
import { getSocialChannelConfig, getSocialChannelLabel } from "@/lib/social/channel-catalog";
import { getSharedMediaLimit, validateSocialPost } from "@/lib/social/post-validation";
import type { SocialChannel } from "@/lib/schemas";
import { isPlatformActionRequiredStatus, LEGACY_EXPORTED_FOR_REVIEW_STATUS, PLATFORM_ACTION_REQUIRED_STATUS } from "@/lib/tiktok-draft-flow";
import {
  emptyTikTokDirectPostForm,
  getTikTokDirectPostBlocker,
  toTikTokDirectPostSettings,
  type TikTokDirectPostFormState,
} from "@/lib/social/tiktok-direct-post-form";

const DRAFT_STORAGE_PREFIX = "markaestro_post_draft";
const isVideoUrl = (url: string) => /\.(mp4|mov|webm)(?:[?&]|$)/i.test(url);

/**
 * TikTok Direct Post is gated until the Content Posting API audit passes.
 * Until then TikTok forces every post from this client to SELF_ONLY, so
 * shipping the option would just offer creators a public post that silently
 * lands as private. Off unless explicitly enabled, so production — which sets
 * nothing — never renders it, while local testing opts in via .env.local.
 * Only the composer UI is gated; the publish path stays intact for the
 * documented `settings.postMode` public API field.
 */
const TIKTOK_DIRECT_POST_ENABLED = process.env.NEXT_PUBLIC_TIKTOK_DIRECT_POST === "1";

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
  const t = useTranslations("content.createTab");
  const tTikTok = useTranslations("content.tiktokDirectPost");
  const [channel, setChannel] = useState("facebook");
  const [content, setContent] = useState("");
  const [postId, setPostId] = useState<string | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["facebook"]);
  // Which linked account each channel posts to, when a brand has several.
  const [channelDestinations, setChannelDestinations] = useState<Record<string, string>>({});
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [previewChannel, setPreviewChannel] = useState("facebook");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── TikTok publishing mode ────────────────────────────────────────────────
  // Defaults to the inbox hand-off. Direct Post is opt-in per post and only
  // then does the compliance panel below render or contribute settings.
  const [tiktokPostMode, setTiktokPostMode] = useState<"inbox" | "direct_post">("inbox");
  const [tiktokForm, setTiktokForm] = useState<TikTokDirectPostFormState>(emptyTikTokDirectPostForm);
  const [tiktokCreatorInfo, setTiktokCreatorInfo] = useState<TikTokCreatorInfoState>({ status: "loading" });
  // Keyed by URL so a stale measurement can never be attributed to a video the
  // creator has since swapped out.
  const [measuredVideo, setMeasuredVideo] = useState<{ url: string; seconds: number | null } | null>(null);

  const tiktokSelected = selectedChannels.includes("tiktok");
  const tiktokVideoUrl = mediaUrls.find(isVideoUrl) ?? null;
  const tiktokMediaKind: "video" | "photo" = tiktokVideoUrl ? "video" : "photo";
  const showTikTokModePicker = tiktokSelected && TIKTOK_DIRECT_POST_ENABLED;
  // Gated off, this is always false, so no TikTok settings are attached and
  // every post takes the inbox hand-off exactly as before.
  const directPostActive = showTikTokModePicker && tiktokPostMode === "direct_post";
  const videoDurationSec = tiktokVideoUrl && measuredVideo?.url === tiktokVideoUrl
    ? measuredVideo.seconds
    : null;

  // TikTok caps video length per account (max_video_post_duration_sec), so the
  // duration has to be known before the post button can be trusted. Read it
  // from the uploaded file's metadata rather than trusting the creator.
  useEffect(() => {
    if (!tiktokVideoUrl || typeof document === "undefined") return;
    let cancelled = false;
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      if (cancelled) return;
      setMeasuredVideo({
        url: tiktokVideoUrl,
        seconds: Number.isFinite(probe.duration) ? probe.duration : null,
      });
    };
    probe.onerror = () => {
      if (!cancelled) setMeasuredVideo({ url: tiktokVideoUrl, seconds: null });
    };
    probe.src = tiktokVideoUrl;
    return () => { cancelled = true; probe.src = ""; };
  }, [tiktokVideoUrl]);

  const tiktokBlocker = directPostActive && tiktokCreatorInfo.status === "ready"
    ? getTikTokDirectPostBlocker(tiktokForm, videoDurationSec, tiktokCreatorInfo.info)
    : null;

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
    deferFromEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as StoredDraft;
      if (!saved.content || content) return;
      setContent(saved.content);
      if (saved.selectedChannels?.length) setSelectedChannels(saved.selectedChannels);
      if (saved.channel) setChannel(saved.channel);
      if (saved.mediaUrls?.length) setMediaUrls(saved.mediaUrls);
      toast.info(t("restoredDraft"), {
        action: {
          label: t("discard"),
          onClick: () => {
            localStorage.removeItem(draftKey);
            setContent("");
            setMediaUrls([]);
          },
        },
      });
    } catch { /* corrupt entry — ignore */ }
    });
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
    return Array.from(new Set(selectedChannels)).filter(Boolean);
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
    const targetChannels = getTypedPostTargets();
    if (targetChannels.length === 0) {
      toast.error(t("toasts.selectChannel"));
      return false;
    }

    const issues = validateSocialPost({
      content,
      channel,
      targetChannels,
      mediaUrls: urls,
    });
    if (issues.length > 0) {
      toast.error(issues[0].message);
      return false;
    }

    const tiktokError = getTikTokDirectPostError();
    if (tiktokError) {
      toast.error(tiktokError);
      return false;
    }

    return true;
  };

  /**
   * TikTok Direct Post publishes on the creator's behalf, so the post cannot
   * leave the composer until every required choice is made. Mirrors the
   * server-side checks in `validateTikTokDirectPostSettings`.
   */
  const getTikTokDirectPostError = (): string | null => {
    if (!directPostActive) return null;
    if (tiktokCreatorInfo.status !== "ready") {
      return tTikTok("blockers.creatorInfoUnavailable");
    }
    if (!tiktokBlocker) return null;
    switch (tiktokBlocker.kind) {
      case "privacy_not_selected":
        return tTikTok("blockers.privacyNotSelected");
      case "disclosure_without_selection":
        return tTikTok("blockers.disclosureWithoutSelection");
      case "branded_content_private":
        return tTikTok("blockers.brandedContentPrivate");
      case "video_too_long":
        return tTikTok("blockers.videoTooLong", { maxSeconds: tiktokBlocker.maxSeconds });
    }
  };

  const buildPostPayload = (urls?: string[]) => {
    // Use the typed/filtered target list, not getPostTargets(): selectedChannels
    // can carry a channel key that no longer exists (e.g. restored from an old
    // local draft after a channel was removed from the catalog). Sending that
    // raw value trips the server's targetChannels enum and fails the request
    // with no useful message, even though client-side validation — which
    // already filters through getTypedPostTargets() — reported no problem.
    const targetChannels = getTypedPostTargets();
    const primaryChannel = targetChannels[0] || channel;
    // Only send destinations for channels this post actually targets.
    const targetChannelSet: Set<string> = new Set(targetChannels);
    const destinations = Object.fromEntries(
      Object.entries(channelDestinations).filter(([ch]) => targetChannelSet.has(ch)),
    );
    // Only a Direct Post carries TikTok settings. Inbox posts send none, so
    // they keep behaving exactly as they did before Direct Post existed.
    const tiktokSettings = directPostActive && tiktokCreatorInfo.status === "ready"
      ? toTikTokDirectPostSettings(tiktokForm, tiktokCreatorInfo.info, tiktokMediaKind)
      : null;

    return {
      content,
      channel: primaryChannel,
      productId,
      targetChannels,
      mediaUrls: urls,
      ...(Object.keys(destinations).length > 0 ? { channelDestinations: destinations } : {}),
      ...(tiktokSettings ? { settings: tiktokSettings } : {}),
    };
  };

  const handleUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const containsVideo = files.some((f) => f.type.startsWith("video/"));
    if (containsVideo && !selectedChannelsAllowVideo()) {
      toast.error(t("toasts.videoNotSupported"));
      return;
    }
    if (containsVideo && files.length > 1) {
      toast.error(t("toasts.videoAlone"));
      return;
    }

    const maxMedia = getMediaLimit();
    const available = maxMedia - mediaUrls.length;
    if (available <= 0) {
      toast.error(t("toasts.maxMedia", { count: maxMedia }));
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
            toast.error(t("toasts.fileTooLarge", { file: file.name, size: isVideo ? "250" : "10" }));
            return null;
          }
          const fd = new FormData();
          fd.append(isVideo ? "video" : "image", file);
          const res = await apiUpload<{ ok: boolean; url: string }>("/api/media/upload", fd);
          if (!res.ok) {
            toast.error(t("toasts.fileUploadFailed", { file: file.name }));
            return null;
          }
          return res.data.url;
        }),
      );
      const uploaded = results.filter((u): u is string => !!u);
      if (uploaded.length > 0) {
        setMediaUrls((prev) => [...prev, ...uploaded].slice(0, maxMedia));
        toast.success(t("toasts.filesUploaded", { count: uploaded.length }));
      }
    } catch {
      toast.error(t("toasts.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  /**
   * Clear the Direct Post choices once a post leaves the composer. TikTok
   * requires the privacy level to have no default value, and a level carried
   * over from the previous post is exactly that — so the next post starts
   * from an unselected form.
   */
  const resetTikTokDirectPostForm = () => {
    setTiktokForm(emptyTikTokDirectPostForm());
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
    toast.error(t("toasts.createFailed"));
    return null;
  };

  const handleSaveDraft = async () => {
    if (!content) return;
    const urls = mediaUrls.length > 0 ? mediaUrls : undefined;
    if (postId) {
      const res = await apiPut(`/api/posts/${postId}`, buildPostPayload(urls));
      if (res.ok) { toast.success(t("toasts.draftSaved")); clearStoredDraft(); onPostCreated?.(); }
      else toast.error(t("toasts.draftSaveFailed"));
    } else {
      const id = await ensurePostId();
      if (id) { toast.success(t("toasts.draftSaved")); clearStoredDraft(); onPostCreated?.(); }
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
      toast.success(t("toasts.scheduled"));
      setContent("");
      setPostId(null);
      setMediaUrls([]);
      resetTikTokDirectPostForm();
      clearStoredDraft();
      onPostCreated?.();
    } else {
      toast.error(t("toasts.scheduleFailed"));
    }
  };

  const handlePostNow = async () => {
    if (!content) return;
    if (!validateCurrentPost()) return;
    setPublishing(true);
    const urls = mediaUrls.length > 0 ? mediaUrls : undefined;
    const existingPostId = postId;
    const id = existingPostId ?? await ensurePostId();
    if (!id) { setPublishing(false); return; }
    // A post we just created already holds this exact payload — only an
    // existing draft needs its edits written back before publishing.
    if (existingPostId) {
      await apiPut(`/api/posts/${existingPostId}`, buildPostPayload(urls));
    }

    // The post is persisted now, so the composer can reset while the platform
    // call is still in flight rather than holding the user on a spinner for as
    // long as the platform takes. The outcome arrives as a toast, and the post
    // shows its own state (publishing → published/failed) in the list either
    // way, so nothing is lost if this leg fails.
    const postingToastId = toast.loading(t("toasts.posting"));
    setContent("");
    setPostId(null);
    setMediaUrls([]);
    resetTikTokDirectPostForm();
    clearStoredDraft();
    onPostCreated?.();
    setPublishing(false);

    const res = await apiPost<{
      ok: boolean;
      status?: string;
      pending?: boolean;
      error?: string;
      externalUrl?: string;
      channels?: Array<{ channel: string; success: boolean; externalUrl?: string; error?: string }>;
    }>(`/api/posts/${id}/publish`, {});
    toast.dismiss(postingToastId);
    if (res.ok && res.data.ok) {
      const channels = res.data.channels || [];
      const successful = channels.filter((c) => c.success);
      const failed = channels.filter((c) => !c.success && !c.error?.startsWith("Skipped"));
      const hasTikTok = channels.some((c) => c.channel === "tiktok");

      if (res.data.status === "publishing" || res.data.pending) {
        toast.success(hasTikTok ? t("toasts.tiktokSending") : t("toasts.stillProcessing"));
        startStatusPolling(id);
        return;
      }

      if (isPlatformActionRequiredStatus(res.data.status)) {
        toast.success(t("toasts.tiktokInboxConfirmed"));
        return;
      }

      if (successful.length > 1) {
        toast.success(t("toasts.postedToMultiple", { channels: successful.map((c) => c.channel).join(" & ") }));
      } else if (hasTikTok) {
        toast.success(t("toasts.tiktokInboxConfirmed"));
      } else {
        toast.success(t("toasts.postedSuccess"));
      }

      for (const ch of successful) {
        if (ch.externalUrl) toast.info(`${ch.channel}: ${ch.externalUrl}`);
      }
      for (const ch of failed) {
        toast.error(`${ch.channel}: ${ch.error}`);
      }
    } else {
      toast.error(res.data.error || t("toasts.publishFailed"));
    }
    // The list reflects the post's final state (published/failed) either way.
    onPostCreated?.();
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
  const directPostBlockedReason = getTikTokDirectPostError();

  return (
    <div className="grid gap-8 lg:grid-cols-2" onKeyDown={handleKeyDown}>
      {/* Left column — inputs */}
      <div className="space-y-6">
        <ChannelSelector
          value={channel}
          onChange={handleChannelChange}
          productId={productId}
          selectedChannels={selectedChannels}
          channelDestinations={channelDestinations}
          onChannelDestinationsChange={setChannelDestinations}
          onSelectedChannelsChange={handleSelectedChannelsChange}
        />

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("caption")}</label>
          <ContentEditor content={content} onChange={setContent} channel={channel} channels={selectedChannels} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("media")}</label>
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
                    className="absolute top-1 end-1 bg-black/60 hover:bg-black/80 text-white text-sm w-8 h-8 sm:text-[10px] sm:w-5 sm:h-5 rounded-full flex items-center justify-center"
                    aria-label={t("removeMedia")}
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
                  {t("addMedia")}
                </button>
              )}
            </div>
          ) : (
            <div
              className="border-2 border-dashed border-border/50 hover:border-foreground/30 rounded-xl p-8 text-center cursor-pointer transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <p className="text-sm text-muted-foreground">{allowVideo ? t("dropImagesOrVideos") : t("dropImages")}</p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">{t("mediaCountHint", { count: mediaLimit, hint: allowVideo ? t("mediaHintVideo") : t("mediaHintImage") })}</p>
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
            {uploading ? t("uploading") : t("upload")}
          </Button>
        </div>

        {showTikTokModePicker && (
          <div className="space-y-3">
            <Label>{tTikTok("modeLabel")}</Label>
            <div className="grid gap-2">
              <TikTokModeOption
                selected={tiktokPostMode === "inbox"}
                title={tTikTok("modeInbox")}
                hint={tTikTok("modeInboxHint")}
                onSelect={() => setTiktokPostMode("inbox")}
              />
              <TikTokModeOption
                selected={tiktokPostMode === "direct_post"}
                title={tTikTok("modeDirect")}
                hint={tTikTok("modeDirectHint")}
                onSelect={() => setTiktokPostMode("direct_post")}
              />
            </div>

            {directPostActive && (
              <TikTokDirectPostPanel
                productId={productId}
                mediaKind={tiktokMediaKind}
                state={tiktokForm}
                onStateChange={setTiktokForm}
                creatorInfo={tiktokCreatorInfo}
                onCreatorInfoChange={setTiktokCreatorInfo}
              />
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 pt-2">
          <Button variant="outline" onClick={handleSaveDraft} disabled={!content} className="h-11 sm:h-9 text-xs sm:text-sm">
            {t("saveDraft")}
          </Button>
          <Button variant="outline" onClick={() => setScheduleOpen(true)} disabled={!content} className="h-11 sm:h-9 text-xs sm:text-sm">
            {t("schedule")}
          </Button>
          {/* Direct Post keeps the button disabled until every required choice
              is made — TikTok specifies the button itself must be blocked,
              not just validated on submit. */}
          <Button
            onClick={handlePostNow}
            disabled={publishing || !content || Boolean(directPostBlockedReason)}
            title={directPostBlockedReason || undefined}
            className="h-11 sm:h-9 text-xs sm:text-sm"
          >
            {publishing ? t("posting") : t("postNow")}
          </Button>
        </div>

        {directPostBlockedReason && (
          <p className="text-[11px]" style={{ color: "var(--mk-warn)" }}>
            {directPostBlockedReason}
          </p>
        )}
      </div>

      {/* Right column — preview */}
      <div className="border border-border/40 rounded-lg p-4 sm:p-6 space-y-6 h-fit lg:sticky lg:top-20 bg-card">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("preview")}</h3>
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
            <p className="text-sm text-muted-foreground">{t("previewPlaceholder")}</p>
            <p className="text-xs text-muted-foreground/60 mt-2">{t("previewHint")}</p>
          </div>
        )}
      </div>

      <ScheduleSheet
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        onSchedule={handleSchedule}
        channel={channel}
        tiktokDirectPost={directPostActive}
      />
    </div>
  );
}

function TikTokModeOption({
  selected,
  title,
  hint,
  onSelect,
}: {
  selected: boolean;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full text-start rounded-xl border p-3 transition-colors ${
        selected
          ? "border-foreground bg-foreground/3"
          : "border-border/40 hover:border-foreground/30"
      }`}
    >
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>
    </button>
  );
}
