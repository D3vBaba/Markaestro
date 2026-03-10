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
    <Card className="border hover:border-border transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.04)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {typeof delta === "number" ? (
          <p className="mt-2 flex items-center text-xs text-muted-foreground font-medium">
            <span
              className={`mr-2 inline-flex items-center rounded-md px-1.5 py-0.5 ${
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
