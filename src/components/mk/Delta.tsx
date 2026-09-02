import { TrendingDown, TrendingUp, Minus } from "lucide-react";

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
  const isZero = value === 0;
  const isPos = value > 0;
  const isGood = inverse ? !isPos : isPos;

  if (isZero) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
        <Minus className="h-3 w-3" />
        <span>0{suffix}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
        isGood
          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40"
          : "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40"
      }`}
    >
      {isPos ? (
        <TrendingUp className="h-3 w-3 shrink-0" />
      ) : (
        <TrendingDown className="h-3 w-3 shrink-0" />
      )}
      <span>
        {isPos ? "+" : "-"}
        {Math.abs(value) > 999 ? ">999" : Math.abs(value)}
        {suffix}
      </span>
    </span>
  );
}

