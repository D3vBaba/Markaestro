"use client";

import SlideCard from "./SlideCard";

type Slide = {
  id: string;
  index: number;
  kind: "hook" | "body" | "cta";
  headline: string;
  body: string;
  imageUrl: string;
  imageStatus: "pending" | "generated" | "failed";
  quality?: {
    hookStrength: number;
    readability: number;
    distinctiveness: number;
    visualClarity: number;
    notes: string[];
  };
};

export default function SlideListEditor({
  slides,
  slideshowId,
  onSlideUpdated,
}: {
  slides: Slide[];
  slideshowId: string;
  onSlideUpdated: (updated: Partial<Slide> & { id: string }) => void;
}) {
  if (slides.length === 0) {
    return (
      <div className="border-2 border-dashed border-border/40 rounded-2xl py-16 text-center">
        <p className="text-sm text-muted-foreground">No slides yet. Generate the slideshow to create slides.</p>
      </div>
    );
  }

  const sorted = [...slides].sort((a, b) => a.index - b.index);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {sorted.map((slide) => (
        <SlideCard
          key={slide.id}
          slide={slide}
          slideshowId={slideshowId}
          onRegenerated={onSlideUpdated}
        />
      ))}
    </div>
  );
}
