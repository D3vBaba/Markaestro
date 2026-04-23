export function Spark({
  data,
  color = "var(--mk-ink-40)",
  height = 24,
  fill = true,
}: {
  data: number[];
  color?: string;
  height?: number;
  fill?: boolean;
}) {
  if (!data?.length) return <div style={{ height, width: "100%" }} />;
  const w = 120;
  const h = height;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      className="block"
    >
      {fill && (
        <polygon
          fill={color}
          opacity={0.15}
          points={`0,${h} ${pts} ${w},${h}`}
        />
      )}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.3}
        points={pts}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
