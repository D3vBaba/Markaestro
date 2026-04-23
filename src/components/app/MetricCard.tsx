import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pillStyle } from "@/components/mk/pills";

export default function MetricCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="mk-eyebrow">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="text-[28px] font-semibold mk-figure"
          style={{ color: "var(--mk-ink)" }}
        >
          {value}
        </div>
        {typeof delta === "number" ? (
          <p
            className="mt-2 flex items-center gap-2 text-[11px]"
            style={{ color: "var(--mk-ink-60)" }}
          >
            <span
              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
              style={pillStyle(delta >= 0 ? "pos" : "neg")}
            >
              {delta >= 0 ? "+" : ""}{Math.abs(delta)}%
            </span>
            vs last period
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
