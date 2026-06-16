"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PRODUCT_CATEGORY_OPTIONS,
  categoryColor,
  categoryLabel,
} from "./categories";

/**
 * Premium single-select category dropdown. A styled trigger + an animated
 * popover with a colored dot per category and a check on the active one.
 */
export default function CategorySelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-sm transition-colors",
          "border-border/70 hover:border-foreground/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--mk-accent)]/40",
          open && "border-foreground/40 ring-2 ring-[color:var(--mk-accent)]/30",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: value ? categoryColor(value) : "var(--mk-ink-20)" }}
          />
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? categoryLabel(value) : "Select a category"}
          </span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            role="listbox"
            className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-border/60 shadow-xl"
            style={{ background: "var(--mk-surface)" }}
          >
            <div className="max-h-64 overflow-y-auto p-1">
              {PRODUCT_CATEGORY_OPTIONS.map((opt) => {
                const selected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      selected ? "text-foreground" : "text-foreground/90 hover:bg-muted/60",
                    )}
                    style={selected ? { background: "var(--mk-accent-soft)" } : undefined}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: opt.color }}
                    />
                    <span className="flex-1 truncate">{opt.label}</span>
                    {selected && (
                      <Check className="h-4 w-4 shrink-0" style={{ color: "var(--mk-accent)" }} />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
