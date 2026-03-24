"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import Select from "@/components/app/Select";
import { apiPost, apiPut, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import ProductPicker from "./ProductPicker";
import ChannelSelector from "./ChannelSelector";
import ContentEditor from "./ContentEditor";
import ScheduleSheet from "./ScheduleSheet";
import ImagePicker from "./ImagePicker";
import PlatformPreview from "@/components/app/PlatformPreview";
import { Wand2, PenLine } from "lucide-react";

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

export default function CreateTab({ onPostCreated }: { onPostCreated?: () => void }) {
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [productId, setProductId] = useState("");
  const [channel, setChannel] = useState("facebook");
  const [contentType, setContentType] = useState("social_post");
  const [additionalContext, setAdditionalContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState("");
  const [postId, setPostId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageStyle, setImageStyle] = useState("branded");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageContext, setImageContext] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleChannelChange = (ch: string) => {
    setChannel(ch);
    setAspectRatio(channelDefaultRatio[ch] || "1:1");
  };

  const [screenUrls, setScreenUrls] = useState<string[]>([]);
  const [uploadingScreen, setUploadingScreen] = useState(false);
  const [includeLogo, setIncludeLogo] = useState(false);
  const screenInputRef = useRef<HTMLInputElement>(null);

  // Manual mode
  const [manualUploading, setManualUploading] = useState(false);
  const manualFileInputRef = useRef<HTMLInputElement>(null);

  const handleManualUpload = async (file: File) => {
    const isVideo = file.type.startsWith("video/");
    const maxSize = isVideo ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) { toast.error(`File must be under ${isVideo ? "100" : "10"} MB`); return; }
    setManualUploading(true);
    try {
      const fd = new FormData();
      fd.append(isVideo ? "video" : "image", file);
      const res = await apiUpload<{ ok: boolean; url: string }>("/api/ai/images", fd);
      if (res.ok) {
        setImageUrl(res.data.url);
        toast.success(`${isVideo ? "Video" : "Image"} uploaded`);
      } else {
        toast.error("Upload failed");
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
    setImageUrl(null);
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
    if (!content) {
      toast.error("Generate content first");
      return;
    }
    setGeneratingImage(true);
    try {
      const prompt = imageContext
        ? `${imageContext}\n\nPost caption for context: ${content}`
        : content;
      const res = await apiPost<{ imageUrl: string; provider: string; revisedPrompt?: string }>(
        "/api/ai/generate-image",
        {
          prompt,
          productId: productId || undefined,
          channel,
          style: imageStyle,
          aspectRatio,
          provider: "gemini",
          screenUrls: screenUrls.length > 0 ? screenUrls : undefined,
          includeLogo,
        },
      );
      if (res.ok) {
        setImageUrl(res.data.imageUrl);
        toast.success(`Image generated via ${res.data.provider}`);
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
    const mediaUrls = imageUrl ? [imageUrl] : undefined;
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
    const mediaUrls = imageUrl ? [imageUrl] : undefined;
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
    const mediaUrls = imageUrl ? [imageUrl] : undefined;
    const id = postId ?? await ensurePostId();
    if (!id) return;
    const res = await apiPut(`/api/posts/${id}`, { content, channel, status: "scheduled", scheduledAt, mediaUrls });
    if (res.ok) {
      toast.success("Post scheduled");
      setContent("");
      setPostId(null);
      setImageUrl(null);
      onPostCreated?.();
    } else {
      toast.error("Failed to schedule post");
    }
  };

  const handlePostNow = async () => {
    if (!content) return;
    setPublishing(true);
    const mediaUrls = imageUrl ? [imageUrl] : undefined;
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
          toast.success("TikTok accepted the upload. It can take a minute to appear, and Direct Post will not create an inbox draft.");
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
        toast.success("TikTok posted. Check the connected account's private posts, not drafts or inbox notifications.");
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
      setImageUrl(null);
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
            <Wand2 className="w-3.5 h-3.5" />
            AI Generate
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-all ${
              mode === "manual"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <PenLine className="w-3.5 h-3.5" />
            Manual Post
          </button>
        </div>

        <ProductPicker value={productId} onChange={setProductId} />

        <ChannelSelector value={channel} onChange={handleChannelChange} productId={productId} />

        {mode === "manual" ? (
          /* ── Manual path ── */
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Caption</label>
              <ContentEditor content={content} onChange={setContent} channel={channel} />
            </div>

            <div className="space-y-3">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Image</label>
              {imageUrl ? (
                <div className="relative group rounded-xl overflow-hidden border border-border/40">
                  {imageUrl.match(/\.(mp4|mov|webm)(\?|$)/i) ? (
                    <video src={imageUrl} controls className="w-full object-cover max-h-48" />
                  ) : (
                    <img src={imageUrl} alt="Post image" className="w-full object-cover max-h-48" />
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button onClick={() => manualFileInputRef.current?.click()} className="text-white text-xs font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg">Replace</button>
                    <button onClick={() => setPickerOpen(true)} className="text-white text-xs font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg">Gallery</button>
                    <button onClick={() => setImageUrl(null)} className="text-white text-xs font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg">Remove</button>
                  </div>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-border/50 hover:border-foreground/30 rounded-xl p-8 text-center cursor-pointer transition-colors"
                  onClick={() => manualFileInputRef.current?.click()}
                >
                  <p className="text-sm text-muted-foreground">{channel === "tiktok" ? "Drop a video or image" : "Drop an image or click to upload"}</p>
                  <p className="text-[11px] text-muted-foreground/50 mt-1">{channel === "tiktok" ? "MP4, MOV · up to 100 MB / JPG, PNG · up to 10 MB" : "JPG, PNG, WebP · up to 10 MB"}</p>
                </div>
              )}
              <input
                ref={manualFileInputRef}
                type="file"
                accept={channel === "tiktok" ? "image/png,image/jpeg,image/webp,video/mp4,video/quicktime" : "image/png,image/jpeg,image/webp"}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleManualUpload(f); e.target.value = ""; }}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => manualFileInputRef.current?.click()} disabled={manualUploading}>
                  {manualUploading ? "Uploading…" : "Upload Image"}
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setPickerOpen(true)}>
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
              <PlatformPreview content={content} channel={channel} mediaUrls={imageUrl ? [imageUrl] : undefined} />
            </div>

            {/* Image generation */}
            <div className="border-t border-border/30 pt-6 space-y-4">
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
                    {imageStyles.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </Select>
                </div>
              </div>

              {/* Image context */}
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

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateImage}
                  disabled={generatingImage}
                  className="flex-1 text-xs"
                >
                  {generatingImage ? "Generating..." : "Generate Image"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                  className="text-xs"
                >
                  Gallery
                </Button>
              </div>

              {imageUrl && (
                <div className="relative group overflow-hidden rounded-lg border border-border/40">
                  <div
                    className="relative w-full mx-auto"
                    style={{
                      aspectRatio: aspectRatio.replace(":", " / "),
                      maxHeight: "520px",
                    }}
                  >
                    <img
                      src={imageUrl}
                      alt="Generated image"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between">
                    <span className="text-white text-[10px] font-medium tracking-wide uppercase">
                      {aspectRatio} / {channel}
                    </span>
                    <button
                      onClick={() => setImageUrl(null)}
                      className="text-white text-[11px] font-medium hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>

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

      <ScheduleSheet open={scheduleOpen} onOpenChange={setScheduleOpen} onSchedule={handleSchedule} />
      <ImagePicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={(url) => setImageUrl(url)} />
    </div>
  );
}
