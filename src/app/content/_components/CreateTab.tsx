"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, Save, Clock, Send, ImageIcon, X, FolderOpen, Upload, Smartphone } from "lucide-react";
import Select from "@/components/app/Select";
import { apiPost, apiPut, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import ProductPicker from "./ProductPicker";
import ChannelSelector from "./ChannelSelector";
import ContentEditor from "./ContentEditor";
import ScheduleSheet from "./ScheduleSheet";
import ImagePicker from "./ImagePicker";

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
  { value: "1:1", label: "1:1 (Instagram)" },
  { value: "16:9", label: "16:9 (Facebook/X)" },
  { value: "9:16", label: "9:16 (Stories)" },
  { value: "4:5", label: "4:5 (IG Feed)" },
] as const;

export default function CreateTab({ onPostCreated }: { onPostCreated?: () => void }) {
  const [productId, setProductId] = useState("");
  const [channel, setChannel] = useState("x");
  const [contentType, setContentType] = useState("social_post");
  const [additionalContext, setAdditionalContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState("");
  const [postId, setPostId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Image generation state
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageStyle, setImageStyle] = useState("branded");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Screenshot upload state
  const [screenUrls, setScreenUrls] = useState<string[]>([]);
  const [uploadingScreen, setUploadingScreen] = useState(false);
  const [includeLogo, setIncludeLogo] = useState(false);
  const screenInputRef = useRef<HTMLInputElement>(null);

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
      const res = await apiPost<{ imageUrl: string; provider: string; revisedPrompt?: string }>(
        "/api/ai/generate-image",
        {
          prompt: content,
          productId: productId || undefined,
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

  const handleSaveDraft = async () => {
    if (!postId) return;
    const mediaUrls = imageUrl ? [imageUrl] : undefined;
    const res = await apiPut(`/api/posts/${postId}`, { content, channel, mediaUrls });
    if (res.ok) {
      toast.success("Draft saved");
      onPostCreated?.();
    } else {
      toast.error("Failed to save draft");
    }
  };

  const handleSchedule = async (scheduledAt: string) => {
    if (!postId) return;
    const mediaUrls = imageUrl ? [imageUrl] : undefined;
    const res = await apiPut(`/api/posts/${postId}`, { content, channel, status: "scheduled", scheduledAt, mediaUrls });
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
    if (!postId) return;
    setPublishing(true);
    // First update content if edited
    const mediaUrls = imageUrl ? [imageUrl] : undefined;
    await apiPut(`/api/posts/${postId}`, { content, channel, mediaUrls });
    const res = await apiPost<{ ok: boolean; error?: string; externalUrl?: string }>(`/api/posts/${postId}/publish`, {});
    if (res.ok && res.data.ok) {
      toast.success("Posted successfully!");
      if (res.data.externalUrl) {
        toast.info(`View post: ${res.data.externalUrl}`);
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

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <ProductPicker value={productId} onChange={setProductId} />
        <ChannelSelector value={channel} onChange={setChannel} productId={productId} />

        <div className="space-y-2">
          <label className="text-sm font-medium">Content Type</label>
          <div className="grid grid-cols-3 gap-2">
            {contentTypes.map((ct) => (
              <button
                key={ct.value}
                onClick={() => setContentType(ct.value)}
                className={`text-left p-3 rounded-lg border transition-colors text-sm ${
                  contentType === ct.value
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:border-muted-foreground/30"
                }`}
              >
                {ct.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Additional Context</label>
          <Textarea
            placeholder="Any specific requirements, offers, or constraints..."
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            rows={3}
          />
        </div>

        <Button onClick={handleGenerate} disabled={generating} className="w-full">
          {generating ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</>
          ) : (
            <><Sparkles className="mr-2 h-4 w-4" /> Generate</>
          )}
        </Button>
      </div>

      <Card className="shadow-sm h-fit sticky top-20">
        <CardHeader>
          <CardTitle className="text-base">Content</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {content ? (
            <>
              <ContentEditor content={content} onChange={setContent} channel={channel} />

              {/* Image Generation */}
              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium">Generate Image</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Aspect Ratio</label>
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
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Style</label>
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

                {/* App Screenshots Upload */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Smartphone className="h-3 w-3" /> App Screenshots (phone mockups)
                    </label>
                    <span className="text-xs text-muted-foreground">{screenUrls.length}/4</span>
                  </div>

                  {screenUrls.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {screenUrls.map((url, i) => (
                        <div key={i} className="relative group w-16 h-28 rounded-md overflow-hidden border">
                          <img src={url} alt={`Screenshot ${i + 1}`} className="w-full h-full object-cover" />
                          <button
                            onClick={() => handleRemoveScreen(i)}
                            className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-background/80 border opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-2.5 w-2.5" />
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
                    className="w-full"
                  >
                    {uploadingScreen ? (
                      <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Uploading...</>
                    ) : (
                      <><Upload className="mr-1.5 h-3 w-3" /> Upload Screenshot</>
                    )}
                  </Button>
                </div>

                {/* Include Logo Toggle */}
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
                    className="flex-1"
                  >
                    {generatingImage ? (
                      <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Generating...</>
                    ) : (
                      <><ImageIcon className="mr-1.5 h-3 w-3" /> Generate</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPickerOpen(true)}
                  >
                    <FolderOpen className="mr-1.5 h-3 w-3" /> Gallery
                  </Button>
                </div>

                {imageUrl && (
                  <div className="relative group">
                    <img
                      src={imageUrl}
                      alt="Generated image"
                      className="rounded-lg border w-full max-h-64 object-cover"
                    />
                    <button
                      onClick={() => setImageUrl(null)}
                      className="absolute top-2 right-2 p-1 rounded-full bg-background/80 border opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleSaveDraft}>
                  <Save className="mr-1.5 h-3 w-3" /> Save Draft
                </Button>
                <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
                  <Clock className="mr-1.5 h-3 w-3" /> Schedule
                </Button>
                <Button size="sm" onClick={handlePostNow} disabled={publishing}>
                  {publishing ? (
                    <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Posting...</>
                  ) : (
                    <><Send className="mr-1.5 h-3 w-3" /> Post Now</>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Generated content will appear here.</p>
              <p className="text-xs mt-1">Select a product and channel, then click Generate.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <ScheduleSheet open={scheduleOpen} onOpenChange={setScheduleOpen} onSchedule={handleSchedule} />
      <ImagePicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={(url) => setImageUrl(url)} />
    </div>
  );
}
