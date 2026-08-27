import { useId } from "react";

export function Spark({
  data,
  color = "var(--mk-accent)",
  height = 24,
  fill = true,
}: {
  data: number[];
  color?: string;
  height?: number;
  fill?: boolean;
}) {
  const gradientId = useId();
  if (!data?.length) return <div style={{ height, width: "100%" }} />;

  const w = 120;
  const h = height;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      className="block overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0.0} />
        </linearGradient>
      </defs>
      {fill && (
        <polygon
          fill={`url(#${gradientId})`}
          points={`0,${h} ${pts} ${w},${h}`}
        />
      )}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        points={pts}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

