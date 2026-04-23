type Series = { key: string; color: string; label?: string; opacity?: number };

export function StackedArea<T extends { label: string }>({
  data,
  series,
  height = 220,
  showGrid = true,
}: {
  data: T[];
  series: Series[];
  height?: number;
  showGrid?: boolean;
}) {
  if (!data.length) {
    return (
      <div
        className="grid place-items-center text-sm"
        style={{ height, color: "var(--mk-ink-60)" }}
      >
        No data yet.
      </div>
    );
  }
  const w = 800;
  const h = height;
  const pad = { t: 16, r: 12, b: 28, l: 40 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const totals = data.map((d) =>
    series.reduce((a, s) => a + ((d as Record<string, unknown>)[s.key] as number || 0), 0),
  );
  const max = Math.max(...totals, 1) * 1.1;
  const xs = (i: number) => pad.l + (iw / (data.length - 1 || 1)) * i;
  const ys = (v: number) => pad.t + ih - (v / max) * ih;

  const fmt = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 10_000) return (n / 1000).toFixed(1) + "k";
    if (n >= 1000) return n.toLocaleString();
    return String(n);
  };

  const running: number[] = new Array(data.length).fill(0);
  const layers = series.map((s) => {
    const prev = running.slice();
    const next = data.map(
      (d, i) => (running[i] = prev[i] + (((d as Record<string, unknown>)[s.key] as number) || 0)),
    );
    const top = data
      .map((_, i) => `${i === 0 ? "M" : "L"} ${xs(i).toFixed(1)} ${ys(next[i]).toFixed(1)}`)
      .join(" ");
    const bot = data
      .slice()
      .reverse()
      .map((_, ri) => {
        const i = data.length - 1 - ri;
        return `L ${xs(i).toFixed(1)} ${ys(prev[i]).toFixed(1)}`;
      })
      .join(" ");
    return { key: s.key, color: s.color, opacity: s.opacity ?? 0.88, d: `${top} ${bot} Z` };
  });

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      className="block"
    >
      {showGrid &&
        [0.25, 0.5, 0.75, 1].map((t, i) => (
          <line
            key={i}
            x1={pad.l}
            x2={w - pad.r}
            y1={pad.t + ih * t}
            y2={pad.t + ih * t}
            stroke="var(--mk-rule-soft)"
            strokeWidth={1}
            strokeDasharray={i === 3 ? "0" : "2 4"}
          />
        ))}
      {layers.map((l) => (
        <path key={l.key} d={l.d} fill={l.color} opacity={l.opacity} />
      ))}
      {[0, 0.5, 1].map((t, i) => {
        const v = max * (1 - t);
        return (
          <text
            key={i}
            x={pad.l - 10}
            y={pad.t + ih * t + 4}
            textAnchor="end"
            fontSize={9.5}
            fill="var(--mk-ink-40)"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
          >
            {fmt(Math.round(v))}
          </text>
        );
      })}
      {data.map((d, i) => (
        <text
          key={d.label}
          x={xs(i)}
          y={h - 8}
          textAnchor="middle"
          fontSize={10}
          fill="var(--mk-ink-40)"
          style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}
        >
          {d.label.toUpperCase()}
        </text>
      ))}
    </svg>
  );
}
