"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2, RotateCcw } from "lucide-react";
import type { SocialChannel } from "@/lib/schemas";
import {
  type AspectPresetId,
  getAspectPreset,
  presetsForChannels,
  recommendedPreset,
} from "@/lib/media/aspect-ratios";
import {
  type CropState,
  clampCrop,
  coverExtent,
  identityCrop,
  sourceRect,
} from "@/lib/media/crop-geometry";

/**
 * Crop every image in an upload batch to one shared aspect ratio.
 *
 * The single shared ratio is the point: networks reject a carousel whose
 * images are different shapes — Pinterest answers one with a bare 400 — so
 * letting each image keep its own ratio would recreate the failure this dialog
 * exists to prevent. The ratio applies to the whole batch; the framing within
 * it is per image.
 *
 * Geometry is held in frame-relative units rather than pixels: offsets are
 * fractions of the frame's width/height, and the image is sized as a
 * percentage of the frame. Nothing here has to measure the DOM during render,
 * so the preview and the exported canvas are computed from the same numbers
 * and cannot drift apart.
 */

const MAX_OUTPUT_EDGE = 2048;
const MAX_ZOOM = 4;

type LoadedImage = {
  file: File;
  url: string;
  element: HTMLImageElement;
  width: number;
  height: number;
};

type ImageCropDialogProps = {
  /** Image files awaiting crop. A non-empty list is what opens the dialog. */
  files: File[];
  /** Channels the post targets, used to pick the opening ratio. */
  channels: SocialChannel[];
  onCancel: () => void;
  onConfirm: (files: File[]) => void;
};

/** Output type the browser can encode, keeping PNG/WebP transparency intact. */
function outputType(file: File): string {
  if (file.type === "image/png") return "image/png";
  if (file.type === "image/webp") return "image/webp";
  return "image/jpeg";
}

function outputName(file: File, type: string): string {
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return `${base}-cropped.${ext}`;
}

/** Draw one image's visible frame to a canvas and hand back a File. */
async function renderCrop(
  image: LoadedImage,
  state: CropState,
  frameRatio: number,
): Promise<File> {
  const rect = sourceRect(image.width, image.height, state, frameRatio);

  // Export at source resolution, capped so a 6000px original doesn't come back
  // as an upload that trips the composer's 10MB ceiling.
  const cap = Math.min(1, MAX_OUTPUT_EDGE / Math.max(rect.width, rect.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * cap));
  canvas.height = Math.max(1, Math.round(rect.height * cap));
  const ctx = canvas.getContext("2d");
  if (!ctx) return image.file;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image.element,
    rect.sx,
    rect.sy,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const type = outputType(image.file);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.92 : undefined),
  );
  // Falling back to the original keeps the upload alive rather than dropping
  // the user's file over an encoder hiccup.
  return blob ? new File([blob], outputName(image.file, type), { type }) : image.file;
}

export default function ImageCropDialog({
  files,
  channels,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const t = useTranslations("content.crop");
  const presets = useMemo(() => presetsForChannels(channels), [channels]);

  const [images, setImages] = useState<LoadedImage[]>([]);
  const [crops, setCrops] = useState<CropState[]>([]);
  const [index, setIndex] = useState(0);
  const [decoding, setDecoding] = useState(false);
  const [rendering, setRendering] = useState(false);
  /** Null until the user picks a ratio, so the default keeps tracking channels. */
  const [chosenPresetId, setChosenPresetId] = useState<AspectPresetId | null>(null);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    frameW: number;
    frameH: number;
  } | null>(null);

  // Reset for a new batch during render rather than in an effect, so the first
  // frame already shows the new images' state instead of the previous batch's.
  const [loadedBatch, setLoadedBatch] = useState<File[]>(files);
  if (files !== loadedBatch) {
    setLoadedBatch(files);
    setImages([]);
    setCrops([]);
    setIndex(0);
    setChosenPresetId(null);
    setDecoding(files.length > 0);
  }

  const preset = getAspectPreset(chosenPresetId ?? recommendedPreset(channels).id);
  const open = files.length > 0;
  const current = images[index];
  const crop = crops[index] ?? identityCrop();

  // Decode the batch. Every setState here runs in an async callback, never
  // synchronously in the effect body.
  useEffect(() => {
    if (files.length === 0) return;
    let cancelled = false;
    const created: string[] = [];

    Promise.all(
      files.map(
        (file) =>
          new Promise<LoadedImage | null>((resolve) => {
            const url = URL.createObjectURL(file);
            created.push(url);
            const element = new Image();
            element.onload = () =>
              resolve({
                file,
                url,
                element,
                width: element.naturalWidth,
                height: element.naturalHeight,
              });
            // A file the browser cannot decode is dropped rather than blocking
            // the batch; whatever survives still uploads.
            element.onerror = () => resolve(null);
            element.src = url;
          }),
      ),
    ).then((loaded) => {
      if (cancelled) return;
      const usable = loaded.filter((entry): entry is LoadedImage => entry !== null);
      setImages(usable);
      setCrops(usable.map(identityCrop));
      setDecoding(false);
    });

    return () => {
      cancelled = true;
      // Revoked together with the batch they belong to, so a long composer
      // session doesn't leak one blob URL per upload.
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [files]);

  const setCropAt = (i: number, next: Partial<CropState>) => {
    const image = images[i];
    if (!image) return;
    setCrops((prev) => {
      const copy = [...prev];
      copy[i] = clampCrop(
        { ...(copy[i] ?? identityCrop()), ...next },
        image.width / image.height,
        preset.ratio,
      );
      return copy;
    });
  };

  // A new ratio invalidates every framing, so the batch starts over rather
  // than keeping offsets that no longer mean anything.
  const choosePreset = (id: AspectPresetId) => {
    setChosenPresetId(id);
    setCrops(images.map(identityCrop));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: crop.offsetX,
      originY: crop.offsetY,
      frameW: rect.width,
      frameH: rect.height,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Pixel travel becomes frame-relative here, the one place a measurement is
    // needed — and the rect comes from the event, not a render-time read.
    setCropAt(index, {
      offsetX: drag.originX + (event.clientX - drag.startX) / drag.frameW,
      offsetY: drag.originY + (event.clientY - drag.startY) / drag.frameH,
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const handleConfirm = async () => {
    if (images.length === 0) return;
    setRendering(true);
    try {
      const cropped = await Promise.all(
        images.map((image, i) => renderCrop(image, crops[i] ?? identityCrop(), preset.ratio)),
      );
      onConfirm(cropped);
    } finally {
      setRendering(false);
    }
  };

  const extent = current
    ? coverExtent(current.width / current.height, preset.ratio, crop.zoom)
    : { width: 1, height: 1 };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {images.length > 1
              ? t("descriptionBatch", { count: images.length })
              : t("descriptionSingle")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {presets.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={option.id === preset.id ? "default" : "outline"}
              onClick={() => choosePreset(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative w-full overflow-hidden rounded-md bg-muted touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ aspectRatio: String(preset.ratio) }}
        >
          {!current ? (
            <div className="absolute inset-0 grid place-items-center">
              {decoding && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            </div>
          ) : (
            <img
              src={current.url}
              alt=""
              draggable={false}
              className="absolute max-w-none -translate-x-1/2 -translate-y-1/2"
              style={{
                width: `${extent.width * 100}%`,
                height: `${extent.height * 100}%`,
                left: `${(0.5 + crop.offsetX) * 100}%`,
                top: `${(0.5 + crop.offsetY) * 100}%`,
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="w-10 text-xs text-muted-foreground">{t("zoom")}</span>
          <Slider
            value={[crop.zoom]}
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            onValueChange={([zoom]) => setCropAt(index, { zoom })}
            disabled={!current}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t("reset")}
            disabled={!current}
            onClick={() => setCropAt(index, identityCrop())}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        {images.length > 1 && (
          <div className="flex items-center justify-between">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              {t("previous")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t("position", { current: index + 1, total: images.length })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={index >= images.length - 1}
              onClick={() => setIndex((i) => Math.min(images.length - 1, i + 1))}
            >
              {t("next")}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={rendering}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={rendering || decoding || images.length === 0}
          >
            {rendering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("confirm", { count: images.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
