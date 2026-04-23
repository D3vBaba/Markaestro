import { CHANNELS, type ChannelKey } from "./channels";

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
      <span
        className="grid place-items-center font-mono font-semibold text-white"
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.22),
          background: c.cssVar,
          fontSize: Math.round(size * 0.44),
          letterSpacing: "0.02em",
        }}
      >
        {c.short}
      </span>
      {showLabel && (
        <span className="text-[12.5px] text-mk-ink-80">{c.label}</span>
      )}
    </span>
  );
}
