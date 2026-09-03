import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Brand glyphs for each social channel: a white mark on the platform's colour.
 * Shared by the brand sheet's channel cards, the connect dialog and the
 * post-connect panel so the same account always looks the same.
 */
export const CHANNEL_BRAND: Record<string, { bg: string; icon: ReactNode }> = {
  meta: {
    bg: "#1877F2",
    icon: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="#fff" aria-hidden>
        <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6 4.39 10.97 10.13 11.85v-8.38H7.08v-3.47h3.05V9.41c0-3 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.52c-1.49 0-1.96.93-1.96 1.87v2.25h3.33l-.53 3.47h-2.8v8.38C19.61 23.04 24 18.07 24 12.07z" />
      </svg>
    ),
  },
  instagram: {
    bg: "linear-gradient(135deg,#feda75 0%,#fa7e1e 30%,#d62976 60%,#962fbf 100%)",
    icon: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" strokeWidth="2" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.2" cy="6.8" r="1.1" fill="#fff" stroke="none" />
      </svg>
    ),
  },
  tiktok: {
    bg: "#111111",
    icon: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="#fff" aria-hidden>
        <path d="M16.2 3c.3 1.9 1.4 3.4 3.3 3.6v2.5c-1.2 0-2.4-.4-3.3-1v5.7a5.4 5.4 0 1 1-5.4-5.4c.3 0 .5 0 .8.1v2.6a2.85 2.85 0 1 0 2 2.7V3h2.6z" />
      </svg>
    ),
  },
  threads: {
    bg: "#111111",
    icon: <span className="text-[15px] font-bold leading-none text-white">@</span>,
  },
  pinterest: {
    bg: "#E60023",
    icon: <span className="text-[13px] font-bold leading-none text-white">P</span>,
  },
  linkedin: {
    bg: "#0A66C2",
    icon: <span className="text-[12px] font-bold leading-none text-white">in</span>,
  },
};

/** Normalise LinkedIn's two credential kinds onto the one LinkedIn glyph. */
export function glyphProvider(provider: string): string {
  return provider.startsWith("linkedin") ? "linkedin" : provider;
}

export function ChannelGlyph({
  provider,
  size = 36,
  className,
}: {
  provider: string;
  size?: number;
  className?: string;
}) {
  const brand = CHANNEL_BRAND[glyphProvider(provider)];
  if (!brand) return null;
  const style: CSSProperties = { background: brand.bg, width: size, height: size };
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-[10px] shadow-sm", className)}
      style={style}
      aria-hidden
    >
      {brand.icon}
    </span>
  );
}
