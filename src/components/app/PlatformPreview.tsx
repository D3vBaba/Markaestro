"use client";

import { Heart, MessageCircle, Bookmark, Share2, ExternalLink } from "lucide-react";

export type PlatformPreviewProps = {
  content: string;
  channel: string;
  mediaUrls?: string[];
  externalUrl?: string;
};

/** Check if a URL points to a video file */
function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url);
}

/** Render media (image or video) with proper controls and click behavior */
function MediaDisplay({ url, className, aspectClass }: { url: string; className?: string; aspectClass?: string }) {
  if (isVideoUrl(url)) {
    return <video src={url} className={`${className || ""} ${aspectClass || ""}`} controls playsInline preload="metadata" />;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block cursor-zoom-in">
      <img src={url} alt="" className={`${className || ""} ${aspectClass || ""} hover:opacity-90 transition-opacity`} loading="lazy" />
    </a>
  );
}

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
        <MediaDisplay url={img} className="w-full object-cover" aspectClass="aspect-square" />
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
          <div className="w-9 h-9 rounded-full bg-[#1877F2] flex items-center justify-center shrink-0">
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

      {img && <MediaDisplay url={img} className="w-full object-cover max-h-52" />}

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
        {img ? (
          isVideoUrl(img)
            ? <video src={img} className="absolute inset-0 w-full h-full object-cover opacity-75" controls playsInline preload="metadata" />
            : <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover opacity-75" />
        ) : (
          <div className="absolute inset-0 bg-linear-to-b from-zinc-800 to-zinc-950" />
        )}
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

// ─── Ad Preview Types & Helpers ──────────────────────────────────────────────

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

// ─── Facebook Ad Mockup (phone frame) ────────────────────────────────────────

export function FacebookAdPreview({ headline, primaryText, description, imageUrl, videoUrl, linkUrl, ctaType }: AdPreviewProps) {
  const domain = linkUrl ? linkUrl.replace(/^https?:\/\//, "").split("/")[0] : null;

  return (
    <div className="flex justify-center py-2">
      {/* Phone shell */}
      <div className="relative w-full max-w-75">
        <div
          className="relative rounded-[36px] overflow-hidden bg-zinc-950"
          style={{
            border: "7px solid #1a1a1a",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset, 0 0 0 2px #111 inset, 0 28px 60px rgba(0,0,0,0.45), 0 8px 20px rgba(0,0,0,0.2)",
          }}
        >
          {/* Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-22.5 h-5 bg-zinc-950 z-20 rounded-b-2xl flex items-center justify-center gap-2">
            <div className="w-2 h-2 rounded-full bg-zinc-800" />
            <div className="w-10 h-1.5 rounded-full bg-zinc-800" />
          </div>

          {/* Screen */}
          <div className="bg-white" style={{ minHeight: 480 }}>
            {/* Facebook App topbar */}
            <div className="bg-white border-b border-zinc-100 px-4 pt-6 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xl font-black text-[#1877F2] tracking-tight">facebook</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-zinc-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                    </svg>
                  </div>
                  <div className="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-zinc-600" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.5 2 2 6.14 2 11.26c0 2.85 1.38 5.4 3.55 7.11V22l3.28-1.83c.88.25 1.81.38 2.77.38 5.52 0 10-4.15 10-9.26S17.52 2 12 2z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Feed — ad card */}
            <div className="bg-zinc-50">
              {/* Sponsored post */}
              <div className="bg-white mt-2 pb-1">
                <div className="flex items-start justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[#1877F2] flex items-center justify-center shrink-0">
                      <span className="text-white font-black text-sm leading-none">Y</span>
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-zinc-900 leading-none">Your Product</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[9px] text-zinc-400">Sponsored</span>
                        <span className="text-[9px] text-zinc-400">·</span>
                        <svg className="w-2 h-2 text-zinc-400" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                      </div>
                    </div>
                  </div>
                  <span className="text-zinc-400 text-sm px-1 leading-none mt-0.5">···</span>
                </div>

                {primaryText && (
                  <p className="px-3 pb-2 text-[12px] leading-snug text-zinc-900">
                    {primaryText.length > 110 ? primaryText.slice(0, 110) + "…" : primaryText}
                  </p>
                )}

                {videoUrl ? (
                  <video src={videoUrl} className="w-full aspect-video object-cover" controls playsInline />
                ) : imageUrl ? (
                  <img src={imageUrl} alt="Ad" className="w-full aspect-video object-cover" />
                ) : (
                  <div className="w-full aspect-video bg-linear-to-br from-blue-400 via-blue-500 to-blue-700 flex items-center justify-center">
                    <svg className="w-10 h-10 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-100/80">
                  <div className="min-w-0 flex-1">
                    {domain && <p className="text-[9px] text-zinc-400 uppercase tracking-wide truncate">{domain}</p>}
                    {headline && <p className="text-[12px] font-semibold text-zinc-900 leading-tight truncate">{headline}</p>}
                    {description && <p className="text-[10px] text-zinc-500 truncate">{description}</p>}
                  </div>
                  {ctaType && (
                    <button className="shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded bg-zinc-200 text-zinc-800 whitespace-nowrap">
                      {CTA_LABELS[ctaType] || ctaType}
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-around border-t border-zinc-100 px-2 py-1">
                  {["👍 Like", "💬 Comment", "↗ Share"].map((l) => (
                    <button key={l} className="flex-1 text-center text-[11px] font-medium text-zinc-500 py-1 hover:bg-zinc-50 rounded">
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ghost next-post hint */}
              <div className="bg-white mt-2 px-3 py-2.5 opacity-25 pointer-events-none">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-zinc-200 shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-2 bg-zinc-200 rounded w-20" />
                    <div className="h-1.5 bg-zinc-100 rounded w-14" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="h-2 bg-zinc-100 rounded w-full" />
                  <div className="h-2 bg-zinc-100 rounded w-4/5" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Platform label beneath phone */}
        <p className="text-center text-[10px] text-muted-foreground mt-3 uppercase tracking-widest font-medium">Facebook / Instagram Ad</p>
      </div>
    </div>
  );
}

// ─── Google Ad Mockup (SERP frame) ───────────────────────────────────────────

export function GoogleAdPreview({ headline, primaryText, description, linkUrl, ctaType }: AdPreviewProps) {
  const domain = linkUrl ? linkUrl.replace(/^https?:\/\//, "").split("/")[0] : "yoursite.com";
  const pathPart = linkUrl ? (linkUrl.replace(/^https?:\/\/[^/]+/, "") || "") : "";
  const displayPath = pathPart.length > 28 ? pathPart.slice(0, 28) + "…" : pathPart;

  return (
    <div className="w-full rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-md">
      {/* Browser chrome */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 px-3 py-2.5">
        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-2">
          <div className="flex items-center gap-1 px-3 py-1 bg-white dark:bg-zinc-800 rounded-t-md border border-b-0 border-zinc-200 dark:border-zinc-700 text-[10px] text-zinc-600 dark:text-zinc-300 min-w-0">
            {/* Google favicon */}
            <svg width="10" height="10" viewBox="0 0 24 24" className="shrink-0">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            <span className="truncate max-w-25">Google Search</span>
          </div>
          <div className="h-1 flex-1" />
        </div>

        {/* Address + search bar */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-4 h-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </div>
            <div className="w-4 h-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center opacity-50">
              <svg className="w-2.5 h-2.5 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M9 19l7-7-7-7" />
              </svg>
            </div>
          </div>
          <div className="flex-1 flex items-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full px-3 h-7 gap-2">
            <svg className="w-3 h-3 text-zinc-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <span className="text-[11px] text-zinc-500 truncate flex-1">{headline || "your search query"}</span>
          </div>
        </div>
      </div>

      {/* Search results area */}
      <div className="px-4 py-3">
        {/* Nav tabs */}
        <div className="flex items-center gap-4 border-b border-zinc-200 dark:border-zinc-700 mb-4 pb-2">
          {["All", "Images", "News", "Maps", "More"].map((tab, i) => (
            <span key={tab} className={`text-[11px] pb-1 ${i === 0 ? "text-blue-600 border-b-2 border-blue-600 font-medium" : "text-zinc-500"}`}>{tab}</span>
          ))}
        </div>

        {/* About N results */}
        <p className="text-[10px] text-zinc-400 mb-3">About 1,240,000 results (0.42 seconds)</p>

        {/* Ad result */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-sm bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex items-center justify-center shrink-0">
              <div className="w-3 h-3 bg-blue-500 rounded-sm" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-none truncate">{domain}{displayPath}</p>
            </div>
            <span className="ml-auto shrink-0 text-[9px] border border-zinc-300 dark:border-zinc-600 text-zinc-500 px-1 py-0.5 rounded font-medium uppercase tracking-wide">Sponsored</span>
          </div>

          {headline && (
            <p className="text-[16px] font-normal text-[#1a0dab] dark:text-[#8ab4f8] leading-snug hover:underline cursor-pointer">
              {headline}
            </p>
          )}

          {(primaryText || description) && (
            <p className="text-[12px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {(primaryText || description || "").slice(0, 155)}{((primaryText || description || "").length > 155) ? "…" : ""}
            </p>
          )}

          {ctaType && (
            <div className="pt-1.5">
              <button className="px-3.5 py-1 text-[11px] font-medium rounded-full bg-[#1a73e8] text-white hover:bg-[#1557b0] transition-colors">
                {CTA_LABELS[ctaType] || ctaType}
              </button>
            </div>
          )}
        </div>

        {/* Sitelinks (faded decoration) */}
        <div className="mt-3 grid grid-cols-2 gap-1.5 opacity-35 pointer-events-none">
          {["Features", "Pricing", "About Us", "Contact"].map((link) => (
            <div key={link} className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-2">
              <p className="text-[11px] text-[#1a0dab] dark:text-[#8ab4f8] font-medium">{link}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5 truncate">Explore {link.toLowerCase()}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-[10px] text-muted-foreground pb-3 uppercase tracking-widest font-medium">Google Search Ad</p>
    </div>
  );
}

// ─── TikTok Ad Mockup (phone frame) ──────────────────────────────────────────

export function TikTokAdPreview({ headline, primaryText, imageUrl, videoUrl, ctaType }: AdPreviewProps) {
  return (
    <div className="flex justify-center py-2">
      <div className="relative w-full max-w-55">
        <div
          className="relative rounded-[36px] overflow-hidden bg-zinc-950"
          style={{
            border: "7px solid #1a1a1a",
            aspectRatio: "9/16",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset, 0 0 0 2px #111 inset, 0 28px 60px rgba(0,0,0,0.45)",
          }}
        >
          {/* Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 bg-zinc-950 z-20 rounded-b-2xl" />

          {/* Background media */}
          {videoUrl ? (
            <video src={videoUrl} className="absolute inset-0 w-full h-full object-cover" playsInline preload="metadata" />
          ) : imageUrl ? (
            <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-linear-to-b from-zinc-800 via-zinc-900 to-zinc-950" />
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 35%, transparent 60%, rgba(0,0,0,0.3) 100%)" }} />

          {/* Top bar */}
          <div className="absolute top-6 left-0 right-0 flex justify-center gap-5 z-10">
            <span className="text-[10px] text-white/50 font-medium">Following</span>
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-white font-bold">For You</span>
              <div className="w-4 h-px bg-white mt-0.5" />
            </div>
          </div>

          {/* Right side actions */}
          <div className="absolute right-2 bottom-16 flex flex-col items-center gap-3.5 z-10">
            <div className="w-7 h-7 rounded-full border-2 border-white overflow-hidden">
              <div className="w-full h-full" style={{ background: "linear-gradient(135deg,#EE1D52,#69C9D0)" }} />
            </div>
            {[
              { icon: Heart, count: "24K" },
              { icon: MessageCircle, count: "1.2K" },
              { icon: Bookmark, count: "5.4K" },
              { icon: Share2, count: "890" },
            ].map(({ icon: Icon, count }, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <Icon className="w-5 h-5 text-white drop-shadow" />
                <span className="text-[8px] text-white font-medium">{count}</span>
              </div>
            ))}
          </div>

          {/* Bottom content */}
          <div className="absolute bottom-0 left-0 right-10 p-3 z-10 space-y-1.5">
            {/* Sponsored badge */}
            <div className="inline-flex items-center gap-1 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-2 py-0.5">
              <span className="text-[8px] text-white/80 font-medium uppercase tracking-wide">Sponsored</span>
            </div>

            <p className="text-[10px] font-bold text-white leading-tight">@yourproduct</p>
            {(primaryText || headline) && (
              <p className="text-[9px] text-white/85 leading-snug line-clamp-2">
                {primaryText || headline}
              </p>
            )}

            {/* CTA button */}
            {ctaType && (
              <div className="pt-1">
                <button className="flex items-center gap-1.5 bg-white text-zinc-900 rounded-full px-3 py-1 text-[10px] font-bold">
                  {CTA_LABELS[ctaType] || ctaType}
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>
            )}

            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-3 h-3 rounded-full animate-spin shrink-0" style={{ background: "linear-gradient(135deg,#EE1D52,#69C9D0)", animationDuration: "3s" }} />
              <p className="text-[7px] text-white/50 truncate">Original sound · yourproduct</p>
            </div>
          </div>
        </div>

        <p className="text-center text-[10px] text-muted-foreground mt-3 uppercase tracking-widest font-medium">TikTok Ad</p>
      </div>
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
