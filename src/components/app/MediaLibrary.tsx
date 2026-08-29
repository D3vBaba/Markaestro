"use client";

/**
 * The workspace's uploaded media, with a delete action.
 *
 * This is the affordance that makes the storage meter above it actionable.
 * Storage is metered and capped per plan, and until this existed a customer who
 * filled their cap had no way to free a single byte: there was no list, no
 * delete, and therefore nothing that could ever call `refundStorage`. Their
 * only options were to delete the workspace or to email support.
 */

import { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { apiDelete } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { userFacingError } from "@/lib/user-facing-errors";
import { toast } from "sonner";

type MediaAssetRow = {
  id: string;
  type: "image" | "video";
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalFileName: string;
  createdByType: "user" | "api_client";
  createdAt: string;
  refCount: number;
  /** Derived 320px thumbnail; null until the worker produces it. */
  thumbnailUrl?: string | null;
};

type MediaListResponse = {
  assets: MediaAssetRow[];
  nextCursor: string | null;
  storage: { usedBytes: number; limitBytes: number };
};

function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units: Array<[number, string]> = [
    [1024 ** 3, "GB"],
    [1024 ** 2, "MB"],
    [1024, "KB"],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) {
      return `${(bytes / size).toLocaleString(locale, { maximumFractionDigits: 1 })} ${unit}`;
    }
  }
  return `${bytes} B`;
}

function formatDate(value: string, locale: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "n/a";
  return new Date(parsed).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

export default function MediaLibrary() {
  const t = useTranslations("settings.media");
  const locale = useLocale();
  const [pending, setPending] = useState<MediaAssetRow | null>(null);

  const { data, loading } = useApiQuery<MediaListResponse>("/api/media?limit=60");

  const handleDelete = useCallback(async () => {
    if (!pending) return;
    try {
      const res = await apiDelete<{ warning?: string; bytesReleased?: number }>(`/api/media/${pending.id}`);
      if (!res.ok) {
        // The server names the blocking posts when an asset is still in use,
        // which is the only thing that tells the user what to do next.
        toast.error(userFacingError(res.data, t("deleteFailed")));
        return;
      }
      toast.success(
        res.data?.warning
          ? t("deletedWithWarning", { warning: res.data.warning })
          : t("deleted", { size: formatBytes(res.data?.bytesReleased ?? 0, locale) }),
      );
      invalidateQueries("/api/media");
    } finally {
      setPending(null);
    }
  }, [pending, t, locale]);

  const assets = data?.assets ?? [];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/40 p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <figure
              key={asset.id}
              className="group relative overflow-hidden rounded-lg border border-border/30 bg-card"
            >
              <div className="flex aspect-square items-center justify-center bg-muted/40">
                {asset.type === "image" ? (
                  <img
                    // ~20 KB per cell instead of the multi-MB original (5.9);
                    // freshly uploaded assets fall back to the original until
                    // the worker derives their thumbnail.
                    src={asset.thumbnailUrl || asset.url}
                    alt={asset.originalFileName || t("untitled")}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <video src={asset.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                )}
              </div>

              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label={t("deleteLabel", { name: asset.originalFileName || t("untitled") })}
                onClick={() => setPending(asset)}
                className="absolute right-2 top-2 h-7 w-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>

              <figcaption className="space-y-0.5 p-2">
                <p className="truncate text-xs font-medium" title={asset.originalFileName}>
                  {asset.originalFileName || t("untitled")}
                </p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {formatBytes(asset.sizeBytes, locale)}, {formatDate(asset.createdAt, locale)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("usedInPosts", { count: asset.refCount })}
                </p>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {data?.nextCursor && (
        <p className="text-xs text-muted-foreground">{t("moreAvailable")}</p>
      )}

      <ConfirmDeleteDialog
        open={Boolean(pending)}
        onOpenChange={(open) => { if (!open) setPending(null); }}
        entity="mediaAsset"
        name={pending?.originalFileName || t("untitled")}
        warning={pending ? t("confirmWarning", { size: formatBytes(pending.sizeBytes, locale) }) : undefined}
        onConfirm={handleDelete}
      />
    </div>
  );
}
