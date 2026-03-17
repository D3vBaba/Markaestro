"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import { Upload } from "lucide-react";

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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImages = () => {
    setLoading(true);
    setSelected(null);
    apiGet<{ images: GalleryImage[] }>("/api/ai/images").then((res) => {
      if (res.ok) setImages(res.data.images);
      setLoading(false);
    });
  };

  useEffect(() => {
    if (open) fetchImages();
  }, [open]);

  const handleUpload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10 MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await apiUpload<{ ok: boolean; url: string }>("/api/ai/images", fd);
      if (res.ok) {
        toast.success("Image uploaded");
        fetchImages();
        setSelected(res.data.url);
      } else {
        toast.error("Upload failed");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

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
          <div className="flex items-center justify-between">
            <DialogTitle>Image Gallery</DialogTitle>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
              />
              <Button
                variant="outline"
                size="sm"
                className="text-xs flex items-center gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? "Uploading…" : "Upload Image"}
              </Button>
            </div>
          </div>
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
              <p className="text-sm text-muted-foreground">No images yet</p>
              <p className="text-xs text-muted-foreground/60 mt-2">Upload an image or generate one in the Create tab.</p>
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
