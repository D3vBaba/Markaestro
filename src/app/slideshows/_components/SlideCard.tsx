"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle } from "lucide-react";

type SlideKind = "hook" | "body" | "cta";
type ImageStatus = "pending" | "generated" | "failed";

type Slide = {
  id: string;
  index: number;
  kind: SlideKind;
  headline: string;
  body: string;
  imageUrl: string;
  imageStatus: ImageStatus;
  quality?: {
    hookStrength: number;
    readability: number;
    distinctiveness: number;
    visualClarity: number;
    notes: string[];
  };
};

const kindColors: Record<SlideKind, string> = {
  hook: "bg-blue-100 text-blue-700",
  body: "bg-zinc-100 text-zinc-600",
  cta: "bg-emerald-100 text-emerald-700",
};

function QualityBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-emerald-400" : pct >= 45 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[9px] text-muted-foreground/60 w-16 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] tabular-nums text-muted-foreground/50 w-6 text-right">{pct}</span>
    </div>
  );
}

export default function SlideCard({
  slide,
  slideshowId,
  onRegenerated,
}: {
  slide: Slide;
  slideshowId: string;
  onRegenerated: (updatedSlide: Partial<Slide> & { id: string }) => void;
}) {
  const [regenerating, setRegenerating] = useState(false);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await apiPost<{ imageUrl: string; imageStatus: string }>(
        `/api/slideshows/${slideshowId}/slides/${slide.id}/regenerate-image`,
        {},
      );
      if (!res.ok) {
        const err = res.data as unknown as { error?: string };
        toast.error(err.error ?? "Regeneration failed");
        return;
      }
      onRegenerated({ id: slide.id, imageUrl: res.data.imageUrl, imageStatus: "generated" });
      toast.success("Image regenerated");
    } catch {
      toast.error("Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  };

  const hasImage = slide.imageStatus === "generated" && slide.imageUrl;
  const isFailed = slide.imageStatus === "failed";
  const isPending = slide.imageStatus === "pending";

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden bg-card group">
      {/* Image area */}
      <div className="relative aspect-[9/16] bg-muted/30 overflow-hidden">
        {hasImage ? (
          <img
            src={slide.imageUrl}
            alt={slide.headline}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            {isFailed ? (
              <AlertTriangle className="w-5 h-5 text-red-400" />
            ) : (
              <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/60 animate-spin" />
            )}
            <span className="text-[10px] text-muted-foreground/50">
              {isPending ? "Pending" : "Failed"}
            </span>
          </div>
        )}

        {/* Slide number badge */}
        <span className="absolute top-2 left-2 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded-md">
          {slide.index + 1}
        </span>

        {/* Kind badge */}
        <span className={`absolute top-2 right-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-md capitalize ${kindColors[slide.kind]}`}>
          {slide.kind}
        </span>

        {/* Regenerate button (hover) */}
        <div className="absolute inset-x-0 bottom-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="sm"
            variant="outline"
            className="w-full h-7 text-[10px] bg-white/90 hover:bg-white border-white/60"
            onClick={handleRegenerate}
            disabled={regenerating}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerating…" : "Regenerate"}
          </Button>
        </div>
      </div>

      {/* Text content */}
      <div className="px-3 py-2.5 space-y-1.5">
        <p className="text-[11px] font-semibold leading-snug line-clamp-2">{slide.headline}</p>
        {slide.body && (
          <p className="text-[10px] text-muted-foreground line-clamp-2">{slide.body}</p>
        )}

        {/* Quality bars */}
        {slide.quality && (
          <div className="pt-1 space-y-1 border-t border-border/30 mt-2">
            <QualityBar value={slide.quality.hookStrength} label="Hook" />
            <QualityBar value={slide.quality.readability} label="Readability" />
            <QualityBar value={slide.quality.distinctiveness} label="Distinct." />
          </div>
        )}

        {/* Quality warnings */}
        {slide.quality?.notes && slide.quality.notes.length > 0 && (
          <p className="text-[9px] text-amber-600 leading-snug line-clamp-2">
            {slide.quality.notes[0]}
          </p>
        )}
      </div>
    </div>
  );
}
