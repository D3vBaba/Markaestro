import { ChannelGlyph } from "@/components/app/ChannelGlyph";
import { CHANNELS, type ChannelKey } from "./channels";

/**
 * Channel chip used across the app (dashboard, calendar, posts, analytics):
 * the platform's real logo mark, optionally followed by its name. Colour and
 * mark come from `ChannelGlyph` so the marketing site and the app agree.
 */
export function Channel({
  channel,
  size = 20,
  showLabel = false,
}: {
  channel: string;
  size?: number;
  showLabel?: boolean;
}) {
  const key = channel?.toLowerCase() as ChannelKey;
  const c = CHANNELS[key];
  if (!c) return null;
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <ChannelGlyph provider={key} size={size} className="shadow-none" />
      {showLabel && (
        <span className="text-[12.5px] text-mk-ink-80">{c.label}</span>
      )}
    </span>
  );
}
