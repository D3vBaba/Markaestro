"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import Select from "@/components/app/Select";
import { apiPost, apiPut, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import ChannelSelector from "./ChannelSelector";
import ContentEditor from "./ContentEditor";
import ScheduleSheet from "./ScheduleSheet";
import ImagePicker from "./ImagePicker";
import PlatformPreview from "@/components/app/PlatformPreview";
import { recommendedStylesByPlatform } from "@/lib/schemas";

const contentTypes = [
  { value: "social_post", label: "Short Post" },
  { value: "ad_copy", label: "Announcement" },
  { value: "full_campaign", label: "Full Campaign" },
] as const;

const imageStyles = [
  { value: "branded", label: "Branded" },
  { value: "photorealistic", label: "Photo" },
  { value: "illustration", label: "Illustration" },
  { value: "minimal", label: "Minimal" },
  { value: "abstract", label: "Abstract" },
] as const;

const imageSubtypeOptions = [
  { value: "", label: "Auto (Random)" },
  { value: "product-hero", label: "Product Hero" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "flat-lay", label: "Flat Lay" },
  { value: "texture-detail", label: "Texture / Detail" },
  { value: "before-after", label: "Before & After" },
  { value: "hands-in-action", label: "Hands in Action" },
  { value: "environment", label: "Environment" },
  { value: "still-life", label: "Still Life" },
  { value: "silhouette", label: "Silhouette" },
  { value: "behind-the-scenes", label: "Behind the Scenes" },
  { value: "ingredients-raw", label: "Ingredients / Raw" },
  { value: "mood-abstract", label: "Mood / Abstract" },
] as const;

const aspectRatios = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Vertical)" },
  { value: "4:5", label: "4:5 (Portrait)" },
  { value: "3:4", label: "3:4 (Tall Portrait)" },
] as const;

const channelDefaultRatio: Record<string, string> = {
  x: "16:9",
  facebook: "1:1",
  instagram: "4:5",
  tiktok: "9:16",
};

const CONTEXT_MAX_LENGTH = 500;
const IMAGE_CUSTOM_PROMPT_MAX_LENGTH = 1200;

export default function CreateTab({
  productId,
  onProductChange: _onProductChange,
  onPostCreated,
}: {
  productId: string;
  onProductChange?: (id: string) => void;
  onPostCreated?: () => void;
}) {
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [channel, setChannel] = useState("facebook");
  const [contentType, setContentType] = useState("social_post");
  const [additionalContext, setAdditionalContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState("");
  const [postId, setPostId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageCount, setImageCount] = useState<number>(1);
  const [imageStyle, setImageStyle] = useState("branded");
  const [imageSubtype, setImageSubtype] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageContext, setImageContext] = useState("");
  const [imagePromptMode, setImagePromptMode] = useState<"guided" | "custom_override">("guided");
  const [customImagePrompt, setCustomImagePrompt] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleChannelChange = (ch: string) => {
    setChannel(ch);
    setAspectRatio(channelDefaultRatio[ch] || "1:1");
    // If the user's current style isn't recommended for the new channel,
    // switch them to the top recommended style for that channel.
    const recs = recommendedStylesByPlatform[ch as keyof typeof recommendedStylesByPlatform];
    if (recs && !recs.includes(imageStyle as typeof recs[number])) {
      setImageStyle(recs[0]);
    }
  };

  // Order styles for the current channel: recommended first (top pick flagged),
  // then the rest. Falls back to the static list for unknown channels.
  const orderedImageStyles = (() => {
    const recs = recommendedStylesByPlatform[channel as keyof typeof recommendedStylesByPlatform];
    if (!recs) return imageStyles.map((s) => ({ ...s, recommended: false, top: false }));
    const recSet = new Set<string>(recs);
    const top = recs[0];
    const recommended = recs.map((v) => imageStyles.find((s) => s.value === v)!).filter(Boolean);
    const rest = imageStyles.filter((s) => !recSet.has(s.value));
    return [...recommended, ...rest].map((s) => ({
      ...s,
      recommended: recSet.has(s.value),
      top: s.value === top,
    }));
  })();

  const [screenUrls, setScreenUrls] = useState<string[]>([]);
  const [uploadingScreen, setUploadingScreen] = useState(false);
  const [includeLogo, setIncludeLogo] = useState(false);
  const screenInputRef = useRef<HTMLInputElement>(null);

  // Manual mode
  const [manualUploading, setManualUploading] = useState(false);
  const manualFileInputRef = useRef<HTMLInputElement>(null);

  const MAX_MEDIA = 6;

  const handleManualUpload = async (files: File[]) => {
    if (files.length === 0) return;
    // TikTok: if any video, only allow a single file
    const containsVideo = files.some((f) => f.type.startsWith("video/"));
    if (containsVideo && files.length > 1) {
      toast.error("Videos must be uploaded on their own");
      return;
    }

    const available = MAX_MEDIA - imageUrls.length;
    if (available <= 0) {
      toast.error(`Maximum ${MAX_MEDIA} media items`);
      return;
    }
    const filesToUpload = files.slice(0, available);

    setManualUploading(true);
    try {
      const results = await Promise.all(
        filesToUpload.map(async (file) => {
          const isVideo = file.type.startsWith("video/");
          const maxSize = isVideo ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
          if (file.size > maxSize) {
            toast.error(`${file.name}: must be under ${isVideo ? "100" : "10"} MB`);
            return null;
          }
          const fd = new FormData();
          fd.append(isVideo ? "video" : "image", file);
          const res = await apiUpload<{ ok: boolean; url: string }>("/api/ai/images", fd);
          if (!res.ok) {
            toast.error(`${file.name}: upload failed`);
            return null;
          }
          return res.data.url;
        }),
      );
      const uploaded = results.filter((u): u is string => !!u);
      if (uploaded.length > 0) {
        setImageUrls((prev) => [...prev, ...uploaded].slice(0, MAX_MEDIA));
        toast.success(`${uploaded.length} file${uploaded.length > 1 ? "s" : ""} uploaded`);
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setManualUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!productId) {
      toast.error("Select a product first");
      return;
    }
    setGenerating(true);
    setContent("");
    setPostId(null);
    setImageUrls([]);
    try {
      const res = await apiPost<{ id: string; content: string }>("/api/posts/generate", {
        productId,
        channel,
        contentType,
        additionalContext,
      });
      if (res.ok) {
        setContent(res.data.content);
        setPostId(res.data.id);
        toast.success("Content generated and saved as draft");
      } else {
        const errData = res.data as unknown as { error?: string };
        toast.error(errData.error || "Generation failed");
      }
    } catch {
      toast.error("Failed to generate content");
    } finally {
      setGenerating(false);
    }
  };

  const handleUploadScreenshot = async (file: File) => {
    if (screenUrls.length >= 4) {
      toast.error("Maximum 4 screenshots allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File must be under 5 MB");
      return;
    }
    setUploadingScreen(true);
    try {
      const formData = new FormData();
      formData.append("screenshot", file);
      const res = await apiUpload<{ ok: boolean; url: string }>(
        "/api/ai/upload-screenshot",
        formData,
      );
      if (res.ok) {
        setScreenUrls((prev) => [...prev, res.data.url]);
        toast.success("Screenshot uploaded");
      } else {
        toast.error("Failed to upload screenshot");
      }
    } catch {
      toast.error("Failed to upload screenshot");
    } finally {
      setUploadingScreen(false);
    }
  };

  const handleRemoveScreen = (index: number) => {
    setScreenUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerateImage = async () => {
    if (!content && imagePromptMode === "guided") {
      toast.error("Generate content first");
      return;
    }
    if (imagePromptMode === "custom_override" && !customImagePrompt.trim()) {
      toast.error("Add a custom image prompt");
      return;
    }
    setGeneratingImage(true);
    try {
      const prompt = imagePromptMode === "custom_override"
        ? customImagePrompt.trim()
        : imageContext
          ? `${imageContext}\n\nPost caption for context: ${content}`
          : content;
      const res = await apiPost<{ imageUrl: string; imageUrls?: string[]; provider: string; revisedPrompt?: string; generated?: number; requested?: number; partial?: boolean }>(
        "/api/ai/generate-image",
        {
          prompt,
          promptMode: imagePromptMode,
          customPrompt: imagePromptMode === "custom_override" ? customImagePrompt.trim() : undefined,
          productId: productId || undefined,
          channel,
          style: imageStyle,
          subtype: imageSubtype || undefined,
          aspectRatio,
          provider: "gemini",
          screenUrls: screenUrls.length > 0 ? screenUrls : undefined,
          includeLogo,
          count: imageCount,
        },
      );
      if (res.ok) {
        const urls = res.data.imageUrls?.length ? res.data.imageUrls : [res.data.imageUrl];
        // Append to any existing selections, capped at MAX_MEDIA
        setImageUrls((prev) => [...prev, ...urls].slice(0, MAX_MEDIA));
        if (res.data.partial) {
          toast.warning(`Generated ${res.data.generated}/${res.data.requested} images (some failed)`);
        } else {
          toast.success(`${urls.length} image${urls.length > 1 ? "s" : ""} generated via ${res.data.provider}`);
        }
      } else {
        const errData = res.data as unknown as { error?: string };
        toast.error(errData.error || "Image generation failed");
      }
    } catch {
      toast.error("Failed to generate image");
    } finally {
      setGeneratingImage(false);
    }
  };

  // Returns the post ID to use — creates a new draft if none exists yet (manual mode)
  const ensurePostId = async (): Promise<string | null> => {
    if (postId) return postId;
    const mediaUrls = imageUrls.length > 0 ? imageUrls : undefined;
    const res = await apiPost<{ id: string }>("/api/posts", { content, channel, status: "draft", mediaUrls });
    if (res.ok) {
      setPostId(res.data.id);
      return res.data.id;
    }
    toast.error("Failed to create post");
    return null;
  };

  const handleSaveDraft = async () => {
    if (!content) return;
    const mediaUrls = imageUrls.length > 0 ? imageUrls : undefined;
    if (postId) {
      const res = await apiPut(`/api/posts/${postId}`, { content, channel, mediaUrls });
      if (res.ok) { toast.success("Draft saved"); onPostCreated?.(); }
      else toast.error("Failed to save draft");
    } else {
      const id = await ensurePostId();
      if (id) { toast.success("Draft saved"); onPostCreated?.(); }
    }
  };

  const handleSchedule = async (scheduledAt: string) => {
    if (!content) return;
    const mediaUrls = imageUrls.length > 0 ? imageUrls : undefined;
    const id = postId ?? await ensurePostId();
    if (!id) return;
    const res = await apiPut(`/api/posts/${id}`, { content, channel, status: "scheduled", scheduledAt, mediaUrls });
    if (res.ok) {
      toast.success("Post scheduled");
      setContent("");
      setPostId(null);
      setImageUrls([]);
      onPostCreated?.();
    } else {
      toast.error("Failed to schedule post");
    }
  };

  const handlePostNow = async () => {
    if (!content) return;
    setPublishing(true);
    const mediaUrls = imageUrls.length > 0 ? imageUrls : undefined;
    const id = postId ?? await ensurePostId();
    if (!id) { setPublishing(false); return; }
    await apiPut(`/api/posts/${id}`, { content, channel, mediaUrls });
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
          toast.success("Sending to TikTok. When it's ready, open the TikTok app's inbox to finish the caption and post.");
        } else {
          toast.success("Post submitted and still processing.");
        }
        onPostCreated?.();
        setPublishing(false);
        return;
      }

      if (successful.length > 1) {
        toast.success(`Posted to ${successful.map((c) => c.channel).join(" & ")}!`);
      } else if (hasTikTok) {
        toast.success("Sent to TikTok as a draft. Open the TikTok app's inbox, finish the caption, and tap Post.");
      } else {
        toast.success("Posted successfully!");
      }

      for (const ch of successful) {
        if (ch.externalUrl) {
          toast.info(`${ch.channel}: ${ch.externalUrl}`);
        }
      }

      for (const ch of failed) {
        toast.error(`${ch.channel}: ${ch.error}`);
      }

      setContent("");
      setPostId(null);
      setImageUrls([]);
      onPostCreated?.();
    } else {
      toast.error(res.data.error || "Publishing failed");
    }
    setPublishing(false);
  };

  const actionButtons = (
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
  );

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Left column — inputs */}
      <div className="space-y-6">
        {/* Mode toggle */}
        <div className="flex rounded-lg border border-border/60 p-1 gap-1">
          <button
            onClick={() => setMode("ai")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-all ${
              mode === "ai"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Generate
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-all ${
              mode === "manual"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Manual Post
          </button>
        </div>

        <ChannelSelector value={channel} onChange={handleChannelChange} productId={productId} />

        {channel === "tiktok" && (
          <div className="flex items-center justify-between gap-3 border border-blue-200/60 bg-blue-50/40 rounded-xl px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-blue-900">TikTok Carousel Slideshow</p>
              <p className="text-[10px] text-blue-700/70 mt-0.5">Create multi-slide AI slideshows optimised for TikTok.</p>
            </div>
            <Link href="/slideshows" className="shrink-0">
              <Button size="sm" variant="outline" className="text-[11px] border-blue-200 text-blue-700 hover:bg-blue-100">
                Try it
              </Button>
            </Link>
          </div>
        )}

        {mode === "manual" ? (
          /* ── Manual path ── */
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Caption</label>
              <ContentEditor content={content} onChange={setContent} channel={channel} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Media</label>
                <span className="text-[11px] text-muted-foreground">{imageUrls.length}/{MAX_MEDIA}</span>
              </div>
              {imageUrls.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {imageUrls.map((url, i) => (
                    <div key={`${url}-${i}`} className="relative group aspect-square rounded-lg overflow-hidden border border-border/40">
                      {url.match(/\.(mp4|mov|webm)(\?|$)/i) ? (
                        <video src={url} className="w-full h-full object-cover" />
                      ) : (
                        <img src={url} alt={`Media ${i + 1}`} className="w-full h-full object-cover" />
                      )}
                      <button
                        onClick={() => setImageUrls((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center"
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {imageUrls.length < MAX_MEDIA && (
                    <button
                      onClick={() => manualFileInputRef.current?.click()}
                      className="aspect-square rounded-lg border-2 border-dashed border-border/50 hover:border-foreground/30 text-xs text-muted-foreground"
                    >
                      + Add
                    </button>
                  )}
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-border/50 hover:border-foreground/30 rounded-xl p-8 text-center cursor-pointer transition-colors"
                  onClick={() => manualFileInputRef.current?.click()}
                >
                  <p className="text-sm text-muted-foreground">{channel === "tiktok" ? "Drop videos or images" : "Drop images or click to upload"}</p>
                  <p className="text-[11px] text-muted-foreground/50 mt-1">Up to {MAX_MEDIA} items · {channel === "tiktok" ? "MP4/MOV ≤100 MB · JPG/PNG ≤10 MB" : "JPG, PNG, WebP · up to 10 MB"}</p>
                </div>
              )}
              <input
                ref={manualFileInputRef}
                type="file"
                multiple
                accept={channel === "tiktok" ? "image/png,image/jpeg,image/webp,video/mp4,video/quicktime" : "image/png,image/jpeg,image/webp"}
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) handleManualUpload(files);
                  e.target.value = "";
                }}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => manualFileInputRef.current?.click()} disabled={manualUploading || imageUrls.length >= MAX_MEDIA}>
                  {manualUploading ? "Uploading…" : "Upload"}
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setPickerOpen(true)} disabled={imageUrls.length >= MAX_MEDIA}>
                  From Gallery
                </Button>
              </div>
            </div>

            {actionButtons}
          </div>
        ) : (
          /* ── AI Generate path ── */
          <>
        <div className="space-y-3">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Content Type</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {contentTypes.map((ct) => (
              <button
                key={ct.value}
                onClick={() => setContentType(ct.value)}
                className={`text-center py-3 rounded-lg border text-xs sm:text-sm transition-all ${
                  contentType === ct.value
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                }`}
              >
                {ct.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Direction & Context</label>
            <span className={`text-[11px] tabular-nums ${additionalContext.length > CONTEXT_MAX_LENGTH ? "text-destructive" : "text-muted-foreground"}`}>
              {additionalContext.length}/{CONTEXT_MAX_LENGTH}
            </span>
          </div>
          <Textarea
            placeholder="Guide the direction of your post: tone, angle, key message, promo details, audience focus..."
            value={additionalContext}
            onChange={(e) => {
              if (e.target.value.length <= CONTEXT_MAX_LENGTH) {
                setAdditionalContext(e.target.value);
              }
            }}
            rows={3}
            className="resize-none"
          />
          <p className="text-[11px] text-muted-foreground/60">
            The AI will follow your direction closely when generating the caption.
          </p>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={generating || additionalContext.length > CONTEXT_MAX_LENGTH}
          className="w-full h-12 text-sm font-medium tracking-wide"
        >
          {generating ? "Generating..." : "Generate Content"}
        </Button>
          </>
        )}
      </div>

      {/* Right column — content preview */}
      <div className="border border-border/40 rounded-lg p-4 sm:p-6 space-y-6 h-fit lg:sticky lg:top-20 bg-card">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Content Preview</h3>

        {content ? (
          <>
            <ContentEditor content={content} onChange={setContent} channel={channel} />

            {/* Platform preview */}
            <div className="border-t border-border/30 pt-6">
              <PlatformPreview content={content} channel={channel} mediaUrls={imageUrls.length > 0 ? imageUrls : undefined} />
            </div>

            {/* Image generation — AI mode only */}
            {mode === "ai" && (<div className="border-t border-border/30 pt-6 space-y-4">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Image</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">Aspect Ratio</label>
                  <Select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    size="sm"
                  >
                    {aspectRatios.map((ar) => (
                      <option key={ar.value} value={ar.value}>{ar.label}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">Style</label>
                  <Select
                    value={imageStyle}
                    onChange={(e) => setImageStyle(e.target.value)}
                    size="sm"
                  >
                    {orderedImageStyles.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.top ? `★ ${s.label} (recommended)` : s.recommended ? `${s.label} ✓` : s.label}
                      </option>
                    ))}
                  </Select>
                  <p className="text-[10px] text-muted-foreground/50">
                    {channel === "tiktok"
                      ? "★ Raw UGC photos win on TikTok — unbranded UGC outperforms polished ads by +55% ROI."
                      : channel === "instagram"
                      ? "★ Lifestyle photos with people lead on Instagram — faces lift engagement by +38%."
                      : channel === "facebook"
                      ? "★ Lifestyle product-in-use photos drive ~70–80% of Meta ad performance."
                      : "★ = best fit for this channel. ✓ = also performs well."}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">Visual Type</label>
                <Select
                  value={imageSubtype}
                  onChange={(e) => setImageSubtype(e.target.value)}
                  size="sm"
                >
                  {imageSubtypeOptions.map((st) => (
                    <option key={st.value} value={st.value}>{st.label}</option>
                  ))}
                </Select>
                <p className="text-[10px] text-muted-foreground/50">Controls what kind of scene is generated. &quot;Auto&quot; picks randomly for variety.</p>
              </div>

              {/* Image context */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[11px] text-muted-foreground">Prompt Mode</label>
                  <div className="flex rounded-md border border-border/60 p-0.5 gap-0.5">
                    <button
                      onClick={() => setImagePromptMode("guided")}
                      className={`px-2.5 py-1 text-[11px] rounded transition-all ${
                        imagePromptMode === "guided"
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Guided
                    </button>
                    <button
                      onClick={() => setImagePromptMode("custom_override")}
                      className={`px-2.5 py-1 text-[11px] rounded transition-all ${
                        imagePromptMode === "custom_override"
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Custom Override
                    </button>
                  </div>
                </div>

                {imagePromptMode === "custom_override" ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[11px] text-muted-foreground">Custom Image Prompt</label>
                      <span className={`text-[10px] tabular-nums ${customImagePrompt.length > IMAGE_CUSTOM_PROMPT_MAX_LENGTH ? "text-destructive" : "text-muted-foreground/70"}`}>
                        {customImagePrompt.length}/{IMAGE_CUSTOM_PROMPT_MAX_LENGTH}
                      </span>
                    </div>
                    <Textarea
                      placeholder="Describe exactly what the model should create. In this mode, your brief is the source of truth."
                      value={customImagePrompt}
                      onChange={(e) => {
                        if (e.target.value.length <= IMAGE_CUSTOM_PROMPT_MAX_LENGTH) {
                          setCustomImagePrompt(e.target.value);
                        }
                      }}
                      rows={4}
                      className="resize-none text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground/60">
                      Your prompt overrides Markaestro&apos;s normal creative scene builder. Screenshots and logos stay attached as supporting references.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground">Image Direction (optional)</label>
                    <Textarea
                      placeholder="Describe what you want the image to show: mood, colors, scene, elements..."
                      value={imageContext}
                      onChange={(e) => setImageContext(e.target.value)}
                      rows={2}
                      className="resize-none text-xs"
                    />
                  </div>
                )}
              </div>

              {/* App screenshots */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-muted-foreground">App Screenshots</label>
                  <span className="text-[11px] text-muted-foreground">{screenUrls.length}/4</span>
                </div>

                {screenUrls.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {screenUrls.map((url, i) => (
                      <div key={i} className="relative group w-14 h-24 rounded overflow-hidden border border-border/50">
                        <img src={url} alt={`Screenshot ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => handleRemoveScreen(i)}
                          className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={screenInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadScreenshot(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => screenInputRef.current?.click()}
                  disabled={uploadingScreen || screenUrls.length >= 4}
                  className="w-full text-xs"
                >
                  {uploadingScreen ? "Uploading..." : "Upload Screenshot"}
                </Button>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeLogo}
                  onChange={(e) => setIncludeLogo(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-xs text-muted-foreground">Include product logo</span>
              </label>

              {/* Count picker (1–6). Generated images are appended to the current set. */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-muted-foreground">Images to Generate</label>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{imageCount}</span>
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {[1, 2, 3, 4, 5, 6].map((n) => {
                    const remaining = MAX_MEDIA - imageUrls.length;
                    const disabled = n > remaining;
                    return (
                      <button
                        key={n}
                        onClick={() => setImageCount(n)}
                        disabled={disabled}
                        className={`py-1.5 rounded-md text-xs border transition-all ${
                          imageCount === n
                            ? "border-foreground bg-foreground text-background"
                            : "border-border/60 text-muted-foreground hover:border-foreground/30"
                        } ${disabled ? "opacity-30 cursor-not-allowed" : ""}`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/60">Each image counts against your AI quota. Generated images are added to the post ({imageUrls.length}/{MAX_MEDIA}).</p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateImage}
                  disabled={generatingImage || imageUrls.length >= MAX_MEDIA || (imagePromptMode === "custom_override" && customImagePrompt.length > IMAGE_CUSTOM_PROMPT_MAX_LENGTH)}
                  className="flex-1 text-xs"
                >
                  {generatingImage ? "Generating..." : `Generate ${imageCount > 1 ? imageCount + " Images" : "Image"}`}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                  disabled={imageUrls.length >= MAX_MEDIA}
                  className="text-xs"
                >
                  Gallery
                </Button>
              </div>

              {imageUrls.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Selected ({imageUrls.length}/{MAX_MEDIA})</span>
                    {imageUrls.length > 1 && (
                      <button
                        onClick={() => setImageUrls([])}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {imageUrls.map((url, i) => (
                      <div key={`${url}-${i}`} className="relative group aspect-square rounded-lg overflow-hidden border border-border/40">
                        <img src={url} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                          {i + 1}
                        </div>
                        <button
                          onClick={() => setImageUrls((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center"
                          aria-label="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>)}

            {/* Actions */}
            {actionButtons}
          </>
        ) : (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">Generated content will appear here.</p>
            <p className="text-xs text-muted-foreground/60 mt-2">Select a product and channel, then click Generate.</p>
          </div>
        )}
      </div>

      <ScheduleSheet open={scheduleOpen} onOpenChange={setScheduleOpen} onSchedule={handleSchedule} channel={channel} />
      <ImagePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(url) => setImageUrls((prev) => (prev.includes(url) || prev.length >= MAX_MEDIA ? prev : [...prev, url]))}
      />
    </div>
  );
}
