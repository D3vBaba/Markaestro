"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_SIZE = 5 * 1024 * 1024;

export default function MediaUploader({
  value,
  onChange,
  max = 12,
  label,
  description,
  emptyHint,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  label?: string;
  description?: string;
  emptyHint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const remaining = max - value.length;
      if (remaining <= 0) {
        toast.error(`You can upload up to ${max} files`);
        return;
      }
      const arr = Array.from(files).slice(0, remaining);
      const accepted = arr.filter((f) => {
        if (!ACCEPT.split(",").includes(f.type)) {
          toast.error(`${f.name}: unsupported format`);
          return false;
        }
        if (f.size > MAX_SIZE) {
          toast.error(`${f.name}: exceeds 5 MB`);
          return false;
        }
        return true;
      });
      if (accepted.length === 0) return;

      setUploading((n) => n + accepted.length);

      const uploads = accepted.map(async (file) => {
        const fd = new FormData();
        fd.append("screenshot", file);
        const res = await fetch("/api/ai/upload-screenshot", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          toast.error(`${file.name}: upload failed`);
          return null;
        }
        const data = (await res.json()) as { url?: string };
        return data.url || null;
      });

      const results = await Promise.all(uploads);
      const urls = results.filter((u): u is string => !!u);
      setUploading((n) => n - accepted.length);
      if (urls.length > 0) {
        onChange([...value, ...urls]);
      }
    },
    [max, onChange, value],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles],
  );

  const remove = (url: string) => {
    onChange(value.filter((u) => u !== url));
  };

  const atCapacity = value.length >= max;

  return (
    <div className="space-y-3">
      {label && (
        <div className="flex items-end justify-between gap-4">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </label>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {value.length} / {max}
          </span>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!atCapacity) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !atCapacity && inputRef.current?.click()}
        className={cn(
          "relative rounded-xl border border-dashed transition-all cursor-pointer",
          "px-5 py-8 text-center select-none",
          dragOver
            ? "border-foreground bg-foreground/5"
            : atCapacity
            ? "border-border/40 bg-muted/20 cursor-not-allowed opacity-60"
            : "border-border/60 hover:border-foreground/40 hover:bg-muted/20",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex flex-col items-center gap-2">
          {uploading > 0 ? (
            <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
          ) : (
            <Upload className="h-5 w-5 text-muted-foreground" />
          )}
          <p className="text-sm font-medium">
            {uploading > 0
              ? `Uploading ${uploading} file${uploading > 1 ? "s" : ""}…`
              : atCapacity
              ? `Maximum ${max} files reached`
              : "Drop images here or click to upload"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {description || emptyHint || "PNG, JPG, or WebP · up to 5 MB each"}
          </p>
        </div>
      </div>

      {value.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          <AnimatePresence initial={false}>
            {value.map((url, i) => (
              <motion.div
                key={url}
                layout
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="relative aspect-square rounded-lg overflow-hidden border border-border/40 group bg-muted/20"
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
                <span className="absolute top-1 left-1 text-[9px] font-mono tabular-nums rounded bg-black/60 text-white px-1.5 py-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(url);
                  }}
                  className="absolute top-1 right-1 rounded-full bg-black/70 hover:bg-black text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
