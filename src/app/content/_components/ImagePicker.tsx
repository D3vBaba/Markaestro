"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api-client";

type GalleryImage = {
  name: string;
  url: string;
  createdAt: string;
  size: number;
};

export default function ImagePicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (url: string) => void;
}) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected(null);
    apiGet<{ images: GalleryImage[] }>("/api/ai/images").then((res) => {
      if (res.ok) setImages(res.data.images);
      setLoading(false);
    });
  }, [open]);

  const handleConfirm = () => {
    if (selected) {
      onSelect(selected);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Pick from Gallery</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="grid grid-cols-3 gap-3 p-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          ) : images.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No images in gallery</p>
              <p className="text-xs text-muted-foreground/60 mt-2">Generate an image first.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 p-1">
              {images.map((img) => (
                <button
                  key={img.name}
                  onClick={() => setSelected(img.url)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    selected === img.url
                      ? "border-foreground ring-2 ring-foreground/10"
                      : "border-transparent hover:border-muted-foreground/30"
                  }`}
                >
                  <img
                    src={img.url}
                    alt={img.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {selected === img.url && (
                    <div className="absolute inset-0 bg-foreground/10 flex items-center justify-center">
                      <span className="text-xs font-medium bg-foreground text-background px-2 py-1 rounded">Selected</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!selected}>
            Use Image
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
