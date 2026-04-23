export type ChannelKey =
  | "instagram"
  | "tiktok"
  | "facebook"
  | "x"
  | "youtube"
  | "linkedin"
  | "pinterest"
  | "threads";

export const CHANNELS: Record<ChannelKey, { label: string; short: string; cssVar: string }> = {
  instagram: { label: "Instagram", short: "IG", cssVar: "var(--mk-ch-instagram)" },
  tiktok:    { label: "TikTok",    short: "TT", cssVar: "var(--mk-ch-tiktok)" },
  facebook:  { label: "Facebook",  short: "FB", cssVar: "var(--mk-ch-facebook)" },
  x:         { label: "X",         short: "X",  cssVar: "var(--mk-ch-x)" },
  youtube:   { label: "YouTube",   short: "YT", cssVar: "var(--mk-ch-youtube)" },
  linkedin:  { label: "LinkedIn",  short: "LI", cssVar: "var(--mk-ch-linkedin)" },
  pinterest: { label: "Pinterest", short: "PI", cssVar: "var(--mk-ch-pinterest)" },
  threads:   { label: "Threads",   short: "TH", cssVar: "var(--mk-ch-threads)" },
};

export function channelColor(key: string): string {
  const k = key?.toLowerCase() as ChannelKey;
  return CHANNELS[k]?.cssVar ?? "var(--mk-ink-40)";
}

export function channelLabel(key: string): string {
  const k = key?.toLowerCase() as ChannelKey;
  return CHANNELS[k]?.label ?? key;
}
