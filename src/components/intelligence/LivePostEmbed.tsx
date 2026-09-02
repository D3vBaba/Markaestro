"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { channelLabel } from "@/components/mk/channels";
import { cn } from "@/lib/utils";
import { TYPE } from "./shared";

function instagramEmbedSrc(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    // /p/{code}/ or /reel/{code}/
    if ((parts[0] === "p" || parts[0] === "reel") && parts[1]) {
      return `https://www.instagram.com/${parts[0]}/${parts[1]}/embed`;
    }
    return null;
  } catch {
    return null;
  }
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url);
}

export default function LivePostEmbed({
  platform,
  content,
  mediaUrls = [],
  externalUrl,
  armLabel,
  value,
  leading,
}: {
  platform: string;
  content: string;
  mediaUrls?: string[];
  externalUrl?: string | null;
  armLabel: string;
  /** Measured value for this arm once the experiment closed. */
  value?: string;
  leading?: boolean;
}) {
  const t = useTranslations("intelligence.experiments");
  const embedSrc = externalUrl && platform === "instagram" ? instagramEmbedSrc(externalUrl) : null;
  const media = mediaUrls[0];

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-white dark:bg-slate-900", leading ? "border-emerald-300 dark:border-emerald-800" : "border-slate-200/80 dark:border-slate-800/80")}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800/80">
        <span className={TYPE.meta}>
          {t("armLabel", { arm: armLabel })} · {channelLabel(platform)}
        </span>
        <div className="flex items-center gap-3">
          {value !== undefined && (
            <span className={cn("text-sm", TYPE.figure, leading && "text-emerald-700 dark:text-emerald-300")}>{value}</span>
          )}
          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              {t("openLive")}
            </a>
          )}
        </div>
      </div>

      {embedSrc ? (
        <iframe
          title={t("liveEmbedTitle", { arm: armLabel })}
          src={embedSrc}
          className="h-[480px] w-full border-0"
          loading="lazy"
          allow="encrypted-media; clipboard-write"
        />
      ) : (
        <div className="space-y-3 p-3">
          {!externalUrl && <p className={TYPE.hint}>{t("livePending")}</p>}
          {media && (
            isVideoUrl(media) ? (
              <video src={media} controls playsInline preload="metadata" className="max-h-72 w-full rounded-lg object-cover" />
            ) : (
              <img src={media} alt="" className="max-h-72 w-full rounded-lg object-cover" loading="lazy" />
            )
          )}
          <p className={cn("whitespace-pre-wrap", TYPE.body)}>{content || t("untitledPost")}</p>
        </div>
      )}
    </div>
  );
}
