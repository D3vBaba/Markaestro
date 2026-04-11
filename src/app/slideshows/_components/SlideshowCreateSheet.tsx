"use client";

import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import Select from "@/components/app/Select";
import { apiGet, apiPost } from "@/lib/api-client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import CharacterModelPicker from "./CharacterModelPicker";
import type { StoryFormat } from "@/lib/schemas";

type Product = { id: string; name: string };

const slideCountOptions = [3, 4, 5, 6, 7, 8, 9, 10];

const imageStyleOptions = [
  { value: "branded", label: "Branded" },
  { value: "photorealistic", label: "Photorealistic" },
] as const;

const imageProviderOptions = [
  { value: "gemini", label: "Gemini (4K)" },
  { value: "openai", label: "DALL-E 3" },
] as const;

type StoryFormatOption = {
  value: StoryFormat;
  label: string;
  description: string;
  emoji: string;
};

const storyFormatOptions: StoryFormatOption[] = [
  {
    value: "hook_value_cta",
    label: "Hook → Value → CTA",
    description: "Universal. Hook creates desire, each slide delivers one insight, CTA converts.",
    emoji: "⚡",
  },
  {
    value: "problem_solution",
    label: "Problem → Solution",
    description: "Call out the pain, agitate it, reveal the product as the answer.",
    emoji: "💡",
  },
  {
    value: "transformation",
    label: "Before → After",
    description: "Relatable before state, the turning point, the transformation result.",
    emoji: "✨",
  },
  {
    value: "feature_listicle",
    label: "Feature Listicle",
    description: '"N features" hook — each slide = one feature with its real benefit.',
    emoji: "📋",
  },
  {
    value: "ugc_testimonial",
    label: "UGC Testimonial",
    description: 'First-person story arc: "I was struggling with X until I found Y."',
    emoji: "🗣️",
  },
  {
    value: "product_lookbook",
    label: "Product Look Book",
    description: "One product, 4–5 distinct use cases or scenarios per slide.",
    emoji: "📖",
  },
];

export default function SlideshowCreateSheet({
  open,
  onOpenChange,
  defaultProductId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProductId?: string;
}) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState(defaultProductId ?? "");
  const [prompt, setPrompt] = useState("");
  const [slideCount, setSlideCount] = useState(6);
  const [imageStyle, setImageStyle] = useState("branded");
  const [imageProvider, setImageProvider] = useState("gemini");
  const [storyFormat, setStoryFormat] = useState<StoryFormat>("hook_value_cta");
  const [characterModelId, setCharacterModelId] = useState<string | null>(null);
  const [step, setStep] = useState<"format" | "model" | "details">("format");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("format");
    (async () => {
      const res = await apiGet<{ products: Product[] }>("/api/products");
      if (!res.ok) return;
      const list = res.data.products ?? [];
      setProducts(list);
      if (!productId && list.length > 0) setProductId(list[0].id);
    })();
  }, [open]);

  useEffect(() => {
    if (defaultProductId) setProductId(defaultProductId);
  }, [defaultProductId]);

  const handleCreate = async () => {
    if (!productId) { toast.error("Select a product"); return; }
    if (!prompt.trim()) { toast.error("Add a prompt describing your slideshow"); return; }

    setCreating(true);
    try {
      const res = await apiPost<{ id: string }>("/api/slideshows", {
        productId,
        prompt: prompt.trim(),
        slideCount,
        channel: "tiktok",
        aspectRatio: "9:16",
        renderMode: "carousel_images",
        visualStyle: "reelfarm",
        imageStyle,
        imageProvider,
        storyFormat,
        characterModelId: characterModelId ?? undefined,
      });
      if (!res.ok) {
        const err = res.data as unknown as { error?: string };
        toast.error(err.error ?? "Failed to create slideshow");
        return;
      }
      toast.success("Slideshow created");
      onOpenChange(false);
      setPrompt("");
      setStep("format");
      router.push(`/slideshows/${res.data.id}`);
    } finally {
      setCreating(false);
    }
  };

  const selectedFormat = storyFormatOptions.find((f) => f.value === storyFormat)!;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-[480px] flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/30">
          <SheetTitle className="text-base">New TikTok Slideshow</SheetTitle>
          {/* Step indicator */}
          <div className="flex items-center gap-1.5 mt-2">
            {(["format", "model", "details"] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setStep(s)}
                  className={`flex items-center gap-1.5 text-[10px] font-medium transition-colors ${
                    step === s ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground"
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] transition-colors ${
                    step === s ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                  }`}>
                    {i + 1}
                  </span>
                  {s === "format" ? "Format" : s === "model" ? "Model" : "Details"}
                </button>
                {i < 2 && <span className="text-muted-foreground/30">›</span>}
              </div>
            ))}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── Step 1: Story Format ── */}
          {step === "format" && (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-foreground mb-0.5">Choose your story format</p>
                <p className="text-[10px] text-muted-foreground/70">
                  The format determines how your slideshow tells its story.
                </p>
              </div>
              <div className="space-y-2">
                {storyFormatOptions.map((fmt) => (
                  <button
                    key={fmt.value}
                    type="button"
                    onClick={() => setStoryFormat(fmt.value)}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      storyFormat === fmt.value
                        ? "border-primary bg-primary/5"
                        : "border-border/50 hover:border-border"
                    }`}
                  >
                    <span className="text-base flex-shrink-0 mt-0.5">{fmt.emoji}</span>
                    <div className="min-w-0">
                      <div className={`text-xs font-medium ${storyFormat === fmt.value ? "text-primary" : "text-foreground"}`}>
                        {fmt.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 leading-relaxed mt-0.5">
                        {fmt.description}
                      </div>
                    </div>
                    {storyFormat === fmt.value && (
                      <span className="ml-auto flex-shrink-0 text-primary text-xs">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Character Model ── */}
          {step === "model" && (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-foreground mb-0.5">Choose a character model</p>
                <p className="text-[10px] text-muted-foreground/70">
                  The same person will appear consistently across all slides.
                  Powered by Gemini character consistency.
                </p>
              </div>
              <CharacterModelPicker value={characterModelId} onChange={setCharacterModelId} />
            </div>
          )}

          {/* ── Step 3: Details ── */}
          {step === "details" && (
            <>
              {/* Product */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Product
                </label>
                <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {products.length === 0 && <option value="">Loading…</option>}
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>

              {/* Summary of choices */}
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setStep("format")}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>{selectedFormat.emoji}</span>
                  {selectedFormat.label}
                  <span className="text-muted-foreground/50">✎</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("model")}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  👤 {characterModelId ? "Character selected" : "No character"}
                  <span className="text-muted-foreground/50">✎</span>
                </button>
              </div>

              {/* Prompt */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Prompt
                </label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  placeholder="Describe the slideshow — product benefit, audience, tone, key message…"
                  className="resize-none text-sm"
                />
                <p className="text-[10px] text-muted-foreground/60">
                  Be specific: who it's for, what you want viewers to feel, the key benefit.
                </p>
              </div>

              {/* Slide count + image style */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Slides
                  </label>
                  <Select
                    value={String(slideCount)}
                    onChange={(e) => setSlideCount(Number(e.target.value))}
                  >
                    {slideCountOptions.map((n) => (
                      <option key={n} value={n}>{n} slides</option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Image Style
                  </label>
                  <Select value={imageStyle} onChange={(e) => setImageStyle(e.target.value)}>
                    {imageStyleOptions.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </Select>
                </div>
              </div>

              {/* Image provider */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Image Provider
                </label>
                <Select value={imageProvider} onChange={(e) => setImageProvider(e.target.value)}>
                  {imageProviderOptions.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
              </div>
            </>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border/30 flex gap-2">
          {step === "format" && (
            <>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" className="flex-1" onClick={() => setStep("model")}>
                Next: Model →
              </Button>
            </>
          )}
          {step === "model" && (
            <>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setStep("format")}>
                ← Back
              </Button>
              <Button size="sm" className="flex-1" onClick={() => setStep("details")}>
                Next: Details →
              </Button>
            </>
          )}
          {step === "details" && (
            <>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setStep("model")}>
                ← Back
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={handleCreate}
                disabled={creating || !productId || !prompt.trim()}
              >
                {creating ? "Creating…" : "Create Slideshow"}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
