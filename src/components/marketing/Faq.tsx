"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type FaqItem = { q: string; a: string };

export default function Faq({ items, className }: { items: FaqItem[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className={cn("divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card", className)}>
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-5 py-5 text-start sm:px-6"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span className="text-[15px] font-semibold leading-6 text-foreground">{item.q}</span>
              <ChevronDown className={cn("size-4 shrink-0 text-mk-ink-40 transition-transform duration-150", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <p className="m-0 px-5 pb-5 text-[15px] leading-6 text-mk-ink-80 sm:px-6">{item.a}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
