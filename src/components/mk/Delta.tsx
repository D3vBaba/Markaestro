import { cn } from "@/lib/utils";

/**
 * Change vs the prior period. Sign and colour carry the meaning; no arrows,
 * no box, so it sits on the same baseline as the figure it describes.
 */
export function Delta({
  value,
  suffix = "%",
  inverse = false,
  className,
}: {
  value: number | null | undefined;
  suffix?: string;
  inverse?: boolean;
  className?: string;
}) {
  if (value === null || value === undefined) return null;
  const isZero = value === 0;
  const isPos = value > 0;
  const isGood = inverse ? !isPos : isPos;
  const magnitude = Math.abs(value) > 999 ? ">999" : Math.abs(value);

  return (
    <span
      className={cn(
        "inline-flex items-center text-xs font-medium tabular-nums",
        isZero ? "text-mk-ink-40" : isGood ? "text-mk-pos" : "text-mk-neg",
        className,
      )}
    >
      {isZero ? "0" : `${isPos ? "+" : "-"}${magnitude}`}{suffix}
    </span>
  );
}
