"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandOption = { id: string; name: string };

/**
 * Brand context control. A labelled native select styled as a compact
 * control so it sits in a page header next to the actions. Renders nothing
 * when there are no brands to pick from.
 */
export default function BrandSwitcher({
  label,
  emptyLabel,
  products,
  value,
  onChange,
  className,
}: {
  label: string;
  emptyLabel: string;
  products: BrandOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  if (products.length === 0) return null;
  const hasSelection = products.some((product) => product.id === value);

  return (
    <label className={cn("relative inline-flex h-9 w-fit max-w-full items-center gap-2 rounded-lg border border-border bg-card ps-3 pe-8 text-[13px] transition-colors hover:border-mk-ink-20 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <select
        value={hasSelection ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="min-w-0 max-w-[40vw] flex-1 cursor-pointer appearance-none truncate bg-transparent font-medium text-foreground outline-none sm:max-w-[240px]"
      >
        {!hasSelection && (
          <option value="" disabled>
            {emptyLabel}
          </option>
        )}
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-mk-ink-40" aria-hidden="true" />
    </label>
  );
}
