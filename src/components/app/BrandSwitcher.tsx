"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandOption = { id: string; name: string };

/**
 * Brand context bar where the heading *is* the switcher: an eyebrow label
 * over a native <select> styled as the heading text, so the current brand is
 * shown exactly once. Renders nothing when there are no brands to pick from.
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
    <div
      className={cn(
        "mb-6 rounded-2xl px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs",
        className,
      )}
    >
      <label className="block min-w-0">
        <span className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {label}
        </span>
        <span className="relative mt-0.5 inline-flex max-w-full items-center">
          <select
            value={hasSelection ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
            className="max-w-full appearance-none truncate rounded-md bg-transparent pe-7 py-0.5 text-[15px] sm:text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100 outline-none cursor-pointer focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
          <ChevronDown
            className="pointer-events-none absolute end-1 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
        </span>
      </label>
    </div>
  );
}
