"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type GalleryImage = {
  name: string;
  url: string;
  createdAt: string;
  size: number;
  contentType: string;
};

export default function ImageGallery({ refreshKey }: { refreshKey: number }) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiGet<{ images: GalleryImage[] }>("/api/ai/images").then((res) => {
      if (res.ok) setImages(res.data.images);
      setLoading(false);
    });
  }, [refreshKey]);

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    toast.success("Image URL copied");
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleDownload = (url: string, name: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.target = "_blank";
    a.click();
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">No images generated yet</p>
        <p className="text-xs text-muted-foreground/60 mt-2">
          Generate images in the Create tab to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {images.map((img) => (
        <div key={img.name} className="group relative overflow-hidden rounded-lg border border-border/40">
          <img
            src={img.url}
            alt={img.name}
            className="w-full aspect-square object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-start justify-end p-4">
            <p className="text-white text-[11px] truncate w-full mb-1">{img.name}</p>
            <p className="text-white/50 text-[10px] mb-3">
              {new Date(img.createdAt).toLocaleDateString()}
              {" / "}
              {(img.size / 1024).toFixed(0)} KB
            </p>
            <div className="flex gap-2 w-full">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-[11px] flex-1"
                onClick={() => handleCopyUrl(img.url)}
              >
                {copiedUrl === img.url ? "Copied" : "Copy URL"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-[11px]"
                onClick={() => handleDownload(img.url, img.name)}
              >
                Download
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
