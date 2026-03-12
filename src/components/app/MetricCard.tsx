import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card className="card-premium overflow-hidden border-border/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight text-foreground">{value}</div>
        {typeof delta === "number" ? (
          <p className="mt-2 flex items-center text-xs text-muted-foreground font-medium">
            <span
              className={`mr-2 inline-flex items-center rounded-lg px-2 py-0.5 ${
                delta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
              }`}
            >
              {delta >= 0 ? <ArrowUpRight className="mr-0.5 h-3 w-3" /> : <ArrowDownRight className="mr-0.5 h-3 w-3" />}
              {Math.abs(delta)}%
            </span>
            vs last period
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
