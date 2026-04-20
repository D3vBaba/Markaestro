"use client";

import { useState, useRef, useEffect } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import ContentEditor from "./ContentEditor";
import ImagePicker from "./ImagePicker";
import Select from "@/components/app/Select";
import PlatformPreview from "@/components/app/PlatformPreview";
import { apiPost, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import { ImagePlus, ChevronDown, ChevronUp } from "lucide-react";

type Post = {
  id: string;
  content: string;
  channel: string;
  mediaUrls?: string[];
};

const imageStyles = [
  { value: "branded", label: "Branded" },
  { value: "photorealistic", label: "Photo" },
  { value: "illustration", label: "Illustration" },
  { value: "minimal", label: "Minimal" },
  { value: "abstract", label: "Abstract" },
] as const;

const aspectRatios = [
  { value: "1:1", label: "Square 1:1" },
  { value: "16:9", label: "Landscape 16:9" },
  { value: "9:16", label: "Vertical 9:16" },
  { value: "4:5", label: "Portrait 4:5" },
] as const;

const channelDefaultRatio: Record<string, string> = {
  x: "16:9", facebook: "1:1", instagram: "4:5", tiktok: "9:16",
};

const channelLabels: Record<string, string> = {
  x: "X", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok",
};

const IMAGE_CUSTOM_PROMPT_MAX_LENGTH = 4000;

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageStyle, setImageStyle] = useState("branded");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imagePromptMode, setImagePromptMode] = useState<"guided" | "custom_override">("guided");
  const [customImagePrompt, setCustomImagePrompt] = useState("");
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state when post changes
  useEffect(() => {
    if (post) {
      setContent(post.content);
      setMediaUrls(post.mediaUrls ?? []);
      setAspectRatio(channelDefaultRatio[post.channel] ?? "1:1");
      setShowAiPanel(false);
      setImagePromptMode("guided");
      setCustomImagePrompt("");
    }
  }, [post]);

  const channel = post?.channel ?? "facebook";
  const currentImage = mediaUrls[0];

  const handleUpload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10 MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await apiUpload<{ ok: boolean; url: string }>("/api/ai/images", fd);
      if (res.ok) {
        setMediaUrls([res.data.url]);
        toast.success("Image uploaded");
      } else {
        toast.error("Upload failed");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateImage = async () => {
    if (imagePromptMode === "guided" && !content) { toast.error("Add a caption first"); return; }
    if (imagePromptMode === "custom_override" && !customImagePrompt.trim()) { toast.error("Add a custom image prompt"); return; }
    setGeneratingImage(true);
    try {
      const prompt = imagePromptMode === "custom_override" ? customImagePrompt.trim() : content;
      const res = await apiPost<{ imageUrl: string; provider: string }>(
        "/api/ai/generate-image",
        {
          prompt,
          promptMode: imagePromptMode,
          customPrompt: imagePromptMode === "custom_override" ? customImagePrompt.trim() : undefined,
          channel,
          style: imageStyle,
          aspectRatio,
          provider: "gemini",
        }
      );
      if (res.ok) {
        setMediaUrls([res.data.imageUrl]);
        toast.success(`Image generated via ${res.data.provider}`);
      } else {
        const err = res.data as unknown as { error?: string };
        toast.error(err.error || "Generation failed");
      }
    } catch {
      toast.error("Failed to generate image");
    } finally {
      setGeneratingImage(false);
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
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="overflow-y-auto sm:max-w-[560px] flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/30">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-base">{title}</SheetTitle>
              <Badge variant="secondary" className="text-[10px] font-normal capitalize">
                {channelLabels[channel] ?? channel}
              </Badge>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Caption */}
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Caption</p>
              <ContentEditor content={content} onChange={setContent} channel={channel} />
            </div>

            {/* Image */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Image</p>
                {currentImage && (
                  <button
                    onClick={() => setMediaUrls([])}
                    className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>

              {currentImage ? (
                <div className="relative group rounded-xl overflow-hidden border border-border/40">
                  <img src={currentImage} alt="Post image" className="w-full object-cover max-h-56" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-white text-[12px] font-medium bg-white/20 hover:bg-white/30 px-3.5 py-1.5 rounded-lg transition-colors"
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => setPickerOpen(true)}
                      className="text-white text-[12px] font-medium bg-white/20 hover:bg-white/30 px-3.5 py-1.5 rounded-lg transition-colors"
                    >
                      Gallery
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-border/50 hover:border-foreground/30 rounded-xl p-8 text-center cursor-pointer transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Drop an image or click to upload</p>
                  <p className="text-[11px] text-muted-foreground/50 mt-1">JPG, PNG, WebP · up to 10 MB</p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
              />

              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setPickerOpen(true)}
                >
                  Gallery
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs flex items-center gap-1"
                  onClick={() => setShowAiPanel((v) => !v)}
                >
                  AI Image
                  {showAiPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </Button>
              </div>

              {showAiPanel && (
                <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] text-muted-foreground">Prompt Mode</label>
                      <div className="flex rounded-md border border-border/60 p-0.5 gap-0.5">
                        <button
                          onClick={() => setImagePromptMode("guided")}
                          className={`px-2 py-1 text-[10px] rounded transition-all ${
                            imagePromptMode === "guided"
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Guided
                        </button>
                        <button
                          onClick={() => setImagePromptMode("custom_override")}
                          className={`px-2 py-1 text-[10px] rounded transition-all ${
                            imagePromptMode === "custom_override"
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Override
                        </button>
                      </div>
                    </div>
                    {imagePromptMode === "custom_override" && (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[10px] text-muted-foreground">Custom Image Prompt</label>
                          <span className={`text-[10px] tabular-nums ${customImagePrompt.length > IMAGE_CUSTOM_PROMPT_MAX_LENGTH ? "text-destructive" : "text-muted-foreground/70"}`}>
                            {customImagePrompt.length}/{IMAGE_CUSTOM_PROMPT_MAX_LENGTH}
                          </span>
                        </div>
                        <Textarea
                          value={customImagePrompt}
                          onChange={(e) => {
                            if (e.target.value.length <= IMAGE_CUSTOM_PROMPT_MAX_LENGTH) {
                              setCustomImagePrompt(e.target.value);
                            }
                          }}
                          rows={3}
                          placeholder="Describe exactly what image you want. This brief overrides the normal caption-driven prompt builder."
                          className="resize-none text-xs"
                        />
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-muted-foreground">Style</label>
                      <Select value={imageStyle} onChange={(e) => setImageStyle(e.target.value)} size="sm">
                        {imageStyles.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-muted-foreground">Ratio</label>
                      <Select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} size="sm">
                        {aspectRatios.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </Select>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="w-full text-xs"
                    onClick={handleGenerateImage}
                    disabled={generatingImage || (imagePromptMode === "custom_override" && customImagePrompt.length > IMAGE_CUSTOM_PROMPT_MAX_LENGTH)}
                  >
                    {generatingImage ? "Generating…" : imagePromptMode === "custom_override" ? "Generate Image from Custom Prompt" : "Generate Image from Caption"}
                  </Button>
                </div>
              )}
            </div>

            {/* Live preview */}
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
              <PlatformPreview
                content={content}
                channel={channel}
                mediaUrls={currentImage ? [currentImage] : undefined}
              />
            </div>
          </div>

          <SheetFooter className="px-6 py-4 border-t border-border/30 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {onSchedule && (
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onSchedule(content, mediaUrls.length > 0 ? mediaUrls : undefined)}>
                Schedule
              </Button>
            )}
            <Button size="sm" className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ImagePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(url) => { setMediaUrls([url]); setPickerOpen(false); }}
      />
    </>
  );
}
