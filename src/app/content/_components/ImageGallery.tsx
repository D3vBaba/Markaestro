"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api-client";
import { ImageIcon, Download, Copy, Check } from "lucide-react";
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-30" />
        <p className="text-sm font-medium">No images generated yet</p>
        <p className="text-xs mt-1">
          Generate images in the Create tab to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {images.map((img) => (
        <Card key={img.name} className="shadow-sm overflow-hidden group">
          <CardContent className="p-0 relative">
            <img
              src={img.url}
              alt={img.name}
              className="w-full aspect-square object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
              <div className="w-full space-y-2">
                <p className="text-white text-[10px] truncate">{img.name}</p>
                <p className="text-white/60 text-[10px]">
                  {new Date(img.createdAt).toLocaleDateString()}
                  {" · "}
                  {(img.size / 1024).toFixed(0)} KB
                </p>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs flex-1"
                    onClick={() => handleCopyUrl(img.url)}
                  >
                    {copiedUrl === img.url ? (
                      <><Check className="mr-1 h-3 w-3" /> Copied</>
                    ) : (
                      <><Copy className="mr-1 h-3 w-3" /> Copy URL</>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    onClick={() => handleDownload(img.url, img.name)}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
