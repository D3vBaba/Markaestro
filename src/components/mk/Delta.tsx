export function Delta({
  value,
  suffix = "%",
  inverse = false,
}: {
  value: number | null | undefined;
  suffix?: string;
  inverse?: boolean;
}) {
  if (value === null || value === undefined) return null;
  const pos = value > 0;
  const good = inverse ? !pos : pos;
  const color = value === 0
    ? "var(--mk-ink-40)"
    : good
      ? "var(--mk-pos)"
      : "var(--mk-neg)";
  const arrow = value === 0 ? "·" : pos ? "▲" : "▼";
  return (
    <span
      className="font-mono text-[11px]"
      style={{ color, letterSpacing: "-0.01em" }}
    >
      {arrow} {Math.abs(value)}
      {suffix}
    </span>
  );
}
