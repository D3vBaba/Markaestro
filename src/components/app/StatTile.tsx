"use client";

import { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Delta } from "@/components/mk/Delta";
import { Spark } from "@/components/mk/Spark";
import { cn } from "@/lib/utils";

/**
 * One measured number. Label, figure, change vs prior period, optional
 * sparkline and one line of context. Tiles sit in a shared bordered grid
 * (see StatGrid) so they read as one panel, not a row of cards.
 */
export function StatTile({
  label,
  value,
  deltaPct,
  trailing,
  spark,
  sub,
  loading,
  className,
}: {
  label: string;
  value: string;
  deltaPct?: number | null;
  trailing?: ReactNode;
  spark?: number[];
  sub?: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 bg-card px-5 py-5 sm:px-6", className)}>
      <div className="mk-label truncate">{label}</div>
      {loading ? (
        <div className="mt-2 space-y-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
      ) : (
        <>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="mk-figure text-2xl font-semibold text-foreground">{value}</span>
            {typeof deltaPct === "number" ? <Delta value={Math.round(deltaPct)} /> : null}
            {trailing}
          </div>
          {spark && spark.length > 1 ? (
            <div className="mt-3">
              <Spark data={spark} height={22} color="var(--mk-accent)" />
            </div>
          ) : null}
          {sub ? (
            <div className="mt-1.5 truncate text-xs text-muted-foreground" title={sub}>{sub}</div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Bordered container that turns StatTiles into one segmented panel. */
export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
  }[columns];
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border",
        cols,
        className,
      )}
    >
      {children}
    </div>
  );
}
