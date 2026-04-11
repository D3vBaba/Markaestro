"use client";

import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import Select from "@/components/app/Select";
import { apiGet, apiPost } from "@/lib/api-client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type Product = { id: string; name: string };

const slideCountOptions = [3, 4, 5, 6, 7, 8, 9, 10];

const imageStyleOptions = [
  { value: "branded", label: "Branded" },
  { value: "photorealistic", label: "Photorealistic" },
] as const;

const imageProviderOptions = [
  { value: "gemini", label: "Gemini" },
  { value: "openai", label: "DALL-E 3" },
] as const;

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
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
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
      });
      if (!res.ok) {
        const err = res.data as unknown as { error?: string };
        toast.error(err.error ?? "Failed to create slideshow");
        return;
      }
      toast.success("Slideshow created");
      onOpenChange(false);
      setPrompt("");
      router.push(`/slideshows/${res.data.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-[480px] flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/30">
          <SheetTitle className="text-base">New TikTok Slideshow</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
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

          {/* Prompt */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Prompt
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Describe the slideshow you want — product benefit, audience, tone, key message…"
              className="resize-none text-sm"
            />
            <p className="text-[10px] text-muted-foreground/60">
              Be specific: include who it's for, what you want viewers to feel, and the key benefit to highlight.
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
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border/30 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" className="flex-1" onClick={handleCreate} disabled={creating || !productId || !prompt.trim()}>
            {creating ? "Creating…" : "Create Slideshow"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
