import { Fragment } from "react";

export function Heatmap({
  data,
  days,
  hours,
  max,
  color = "var(--mk-accent)",
  height = 160,
}: {
  data: number[][];
  days: string[];
  hours: string[];
  max: number;
  color?: string;
  height?: number;
}) {
  return (
    <div
      className="grid gap-[2px]"
      style={{
        gridTemplateColumns: `28px repeat(${hours.length}, 1fr)`,
        height,
      }}
    >
      <div />
      {hours.map((h, i) => (
        <div
          key={i}
          className="text-center font-mono text-[9px] text-mk-ink-40"
        >
          {h}
        </div>
      ))}
      {days.map((d, di) => (
        <Fragment key={d}>
          <div
            className="flex items-center font-mono text-[9px] text-mk-ink-40"
          >
            {d}
          </div>
          {hours.map((_, hi) => {
            const v = data[di]?.[hi] ?? 0;
            const opacity = (v / max) * 0.95 + 0.04;
            return (
              <div
                key={hi}
                className="rounded-[3px]"
                style={{
                  background: color,
                  opacity,
                  border: "1px solid var(--mk-rule-soft)",
                }}
              />
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
