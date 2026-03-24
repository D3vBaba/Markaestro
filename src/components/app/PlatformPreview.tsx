"use client";

import { Heart, MessageCircle, Bookmark, Share2, ExternalLink } from "lucide-react";

export type PlatformPreviewProps = {
  content: string;
  channel: string;
  mediaUrls?: string[];
  externalUrl?: string;
};

// ─── Instagram ────────────────────────────────────────────────────────────────

function InstagramPreview({ content, mediaUrls }: PlatformPreviewProps) {
  const img = mediaUrls?.[0];
  return (
    <div className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-md">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full p-[2px]" style={{ background: "linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7)" }}>
            <div className="w-full h-full rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full" style={{ background: "linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7)" }} />
            </div>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-zinc-900 dark:text-white leading-none">yourproduct</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">Sponsored</p>
          </div>
        </div>
        <span className="text-zinc-400 text-base leading-none">···</span>
      </div>

      {img ? (
        <img src={img} alt="" className="w-full aspect-square object-cover" />
      ) : (
        <div
          className="w-full aspect-square flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7)" }}
        >
          <svg className="w-10 h-10 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </div>
      )}

      <div className="px-3 pt-2.5 pb-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <Heart className="w-5 h-5 text-zinc-800 dark:text-zinc-200" />
            <MessageCircle className="w-5 h-5 text-zinc-800 dark:text-zinc-200" />
            <Share2 className="w-5 h-5 text-zinc-800 dark:text-zinc-200" />
          </div>
          <Bookmark className="w-5 h-5 text-zinc-800 dark:text-zinc-200" />
        </div>
        <p className="text-[12px] font-semibold text-zinc-900 dark:text-white">0 likes</p>
        <p className="text-[12px] text-zinc-900 dark:text-white leading-snug">
          <span className="font-semibold">yourproduct </span>
          {content.length > 120 ? content.slice(0, 120) + "… more" : content}
        </p>
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">just now</p>
      </div>
    </div>
  );
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

function FacebookPreview({ content, mediaUrls }: PlatformPreviewProps) {
  const img = mediaUrls?.[0];
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#242526] shadow-md overflow-hidden">
      <div className="flex items-start justify-between p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-[#1877F2] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-xl leading-none">f</span>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-zinc-900 dark:text-[#e4e6ea] leading-none">Your Product</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">Just now · 🌐</p>
          </div>
        </div>
        <span className="text-zinc-400 text-base leading-none">···</span>
      </div>

      <p className="px-3 pb-2 text-[13px] leading-snug text-zinc-900 dark:text-[#e4e6ea] whitespace-pre-wrap break-words">
        {content.length > 200 ? content.slice(0, 200) + "…" : content}
      </p>

      {img && <img src={img} alt="" className="w-full object-cover max-h-52" />}

      <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-700/50">
        <div className="flex items-center justify-between text-[11px] text-zinc-500 pb-1.5">
          <span>👍 0</span>
          <span>0 comments</span>
        </div>
        <div className="flex items-center justify-around border-t border-zinc-100 dark:border-zinc-700/50 pt-1.5">
          {["👍 Like", "💬 Comment", "↗ Share"].map((l) => (
            <button key={l} className="flex-1 text-center text-[12px] font-medium text-zinc-500 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-lg transition-colors">
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TikTok ───────────────────────────────────────────────────────────────────

function TikTokPreview({ content, mediaUrls }: PlatformPreviewProps) {
  const img = mediaUrls?.[0];
  return (
    <div className="flex justify-center">
      <div className="relative rounded-[28px] overflow-hidden bg-zinc-950 border border-zinc-800 shadow-2xl" style={{ width: 200, aspectRatio: "9/16" }}>
        {img
          ? <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover opacity-75" />
          : <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-zinc-950" />
        }
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.1) 70%, rgba(0,0,0,0.3) 100%)" }} />

        <div className="absolute top-3 left-0 right-0 flex justify-center gap-5 text-[9px] text-white/70">
          <span>Following</span>
          <span className="font-bold text-white border-b border-white pb-0.5">For You</span>
        </div>

        <div className="absolute right-2 bottom-16 flex flex-col items-center gap-3.5">
          <div className="w-7 h-7 rounded-full border-2 border-white overflow-hidden">
            <div className="w-full h-full" style={{ background: "linear-gradient(135deg,#EE1D52,#69C9D0)" }} />
          </div>
          {([Heart, MessageCircle, Bookmark, Share2] as const).map((Icon, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <Icon className="w-5 h-5 text-white" />
              <span className="text-[8px] text-white">0</span>
            </div>
          ))}
        </div>

        <div className="absolute bottom-0 left-0 right-8 p-3">
          <p className="text-[10px] font-bold text-white mb-0.5">@yourproduct</p>
          <p className="text-[9px] text-white/80 leading-tight line-clamp-3">{content}</p>
          <div className="flex items-center gap-1 mt-1.5">
            <div className="w-3 h-3 rounded-full animate-spin" style={{ background: "linear-gradient(135deg,#EE1D52,#69C9D0)", animationDuration: "3s" }} />
            <p className="text-[7px] text-white/50">Original sound</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Facebook Ad Mockup ───────────────────────────────────────────────────────

export type AdPreviewProps = {
  platform: string;
  headline?: string;
  primaryText?: string;
  description?: string;
  imageUrl?: string;
  videoUrl?: string;
  linkUrl?: string;
  ctaType?: string;
};

const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: "Learn More", SHOP_NOW: "Shop Now", SIGN_UP: "Sign Up",
  DOWNLOAD: "Download", GET_QUOTE: "Get Quote", CONTACT_US: "Contact Us",
};

export function FacebookAdPreview({ headline, primaryText, description, imageUrl, videoUrl, linkUrl, ctaType }: AdPreviewProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#242526] shadow-md overflow-hidden">
      <div className="flex items-start justify-between p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-[#1877F2] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-xl leading-none">f</span>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-zinc-900 dark:text-[#e4e6ea] leading-none">Your Product</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] text-zinc-500">Sponsored · </span>
              <svg className="w-2.5 h-2.5 text-zinc-500" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" />
              </svg>
            </div>
          </div>
        </div>
        <span className="text-zinc-400 text-base leading-none">···</span>
      </div>

      {primaryText && (
        <p className="px-3 pb-2 text-[13px] leading-snug text-zinc-900 dark:text-[#e4e6ea]">
          {primaryText.length > 200 ? primaryText.slice(0, 200) + "…" : primaryText}
        </p>
      )}

      {videoUrl ? (
        <video src={videoUrl} className="w-full aspect-video object-cover bg-muted/20" controls />
      ) : imageUrl ? (
        <img src={imageUrl} alt="Ad" className="w-full aspect-video object-cover" />
      ) : (
        <div className="w-full aspect-video bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          <span className="text-xs text-zinc-400">No media uploaded</span>
        </div>
      )}

      <div className="px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800/60 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {linkUrl && <p className="text-[10px] text-zinc-500 uppercase truncate mb-0.5">{linkUrl.replace(/^https?:\/\//, "")}</p>}
          {headline && <p className="text-[13px] font-semibold text-zinc-900 dark:text-white leading-snug truncate">{headline}</p>}
          {description && <p className="text-[11px] text-zinc-500 truncate mt-0.5">{description}</p>}
        </div>
        {ctaType && (
          <button className="flex-shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md bg-[#1877F2] text-white hover:bg-[#166FE5] transition-colors">
            {CTA_LABELS[ctaType] || ctaType}
          </button>
        )}
      </div>

      <div className="flex items-center justify-around border-t border-zinc-100 dark:border-zinc-700/50 px-3 py-1.5">
        {["👍 Like", "💬 Comment", "↗ Share"].map((l) => (
          <button key={l} className="flex-1 text-center text-[12px] font-medium text-zinc-500 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 rounded-lg transition-colors">
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Generic Google Ad ────────────────────────────────────────────────────────

export function GoogleAdPreview({ headline, primaryText, description, linkUrl, ctaType }: AdPreviewProps) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-md p-4 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] border border-zinc-300 dark:border-zinc-600 text-zinc-500 px-1.5 py-0.5 rounded font-medium">Ad</span>
        {linkUrl && <span className="text-[11px] text-zinc-500 truncate">{linkUrl.replace(/^https?:\/\//, "")}</span>}
      </div>
      {headline && <p className="text-[15px] font-medium text-[#1a0dab] dark:text-[#8ab4f8] leading-snug">{headline}</p>}
      {primaryText && <p className="text-[13px] text-zinc-700 dark:text-zinc-300 leading-snug">{primaryText}</p>}
      {description && <p className="text-[12px] text-zinc-500">{description}</p>}
      {ctaType && (
        <div className="pt-1">
          <button className="px-4 py-1.5 text-[12px] font-semibold rounded-full bg-[#1a73e8] text-white hover:bg-[#1557b0] transition-colors">
            {CTA_LABELS[ctaType] || ctaType}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function PlatformPreview({ content, channel, mediaUrls, externalUrl }: PlatformPreviewProps) {
  if (!content && !mediaUrls?.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
          {channel.charAt(0).toUpperCase() + channel.slice(1)} Preview
        </p>
        {externalUrl && (
          <a href={externalUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            <ExternalLink className="w-3 h-3" /> View live
          </a>
        )}
      </div>

      {channel === "instagram" && <InstagramPreview content={content} channel={channel} mediaUrls={mediaUrls} />}
      {channel === "facebook"  && <FacebookPreview  content={content} channel={channel} mediaUrls={mediaUrls} />}
      {channel === "tiktok"    && <TikTokPreview    content={content} channel={channel} mediaUrls={mediaUrls} />}
      {!["instagram","facebook","tiktok"].includes(channel) && (
        <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        </div>
      )}
    </div>
  );
}
