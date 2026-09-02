"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

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
}: {
  platform: string;
  content: string;
  mediaUrls?: string[];
  externalUrl?: string | null;
  armLabel: string;
}) {
  const t = useTranslations("intelligence.experiments");
  const embedSrc = externalUrl && platform === "instagram" ? instagramEmbedSrc(externalUrl) : null;
  const media = mediaUrls[0];

  return (
    <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--mk-rule-soft)", background: "var(--mk-paper)" }}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: "var(--mk-rule-soft)" }}>
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--mk-ink-60)" }}>
          {t("armLabel", { arm: armLabel })} · {platform}
        </span>
        {externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ color: "var(--mk-accent)" }}
          >
            <ExternalLink className="h-3 w-3" />
            {t("openLive")}
          </a>
        )}
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
          {!externalUrl && (
            <p className="text-[11px] leading-4" style={{ color: "var(--mk-ink-40)" }}>
              {t("livePending")}
            </p>
          )}
          {media && (
            isVideoUrl(media) ? (
              <video src={media} controls playsInline preload="metadata" className="max-h-72 w-full rounded-xl object-cover" />
            ) : (
              <img src={media} alt="" className="max-h-72 w-full rounded-xl object-cover" loading="lazy" />
            )
          )}
          <p className="whitespace-pre-wrap text-[13px] leading-5" style={{ color: "var(--mk-ink)" }}>
            {content || t("untitledPost")}
          </p>
        </div>
      )}
    </div>
  );
}
