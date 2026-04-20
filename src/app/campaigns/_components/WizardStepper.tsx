"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardStep = {
  key: string;
  label: string;
  hint?: string;
};

export default function WizardStepper({
  steps,
  current,
  onStepClick,
}: {
  steps: WizardStep[];
  current: number;
  onStepClick?: (index: number) => void;
}) {
  return (
    <div className="w-full">
      <ol className="flex items-stretch gap-0">
        {steps.map((step, i) => {
          const state: "done" | "active" | "pending" =
            i < current ? "done" : i === current ? "active" : "pending";
          const clickable = !!onStepClick && i <= current;

          return (
            <li key={step.key} className="flex-1 min-w-0">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onStepClick?.(i)}
                className={cn(
                  "group relative w-full text-left pl-3 pr-3 py-3",
                  "border-t-2 transition-colors",
                  state === "active" && "border-foreground",
                  state === "done" && "border-foreground/40",
                  state === "pending" && "border-border/40",
                  clickable && "cursor-pointer hover:bg-muted/30",
                  !clickable && "cursor-default",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "relative h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-mono tabular-nums shrink-0",
                      state === "done" && "bg-foreground text-background",
                      state === "active" &&
                        "bg-foreground text-background ring-2 ring-foreground/15 ring-offset-1 ring-offset-background",
                      state === "pending" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {state === "done" ? (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 480, damping: 18 }}
                      >
                        <Check className="h-3 w-3" />
                      </motion.span>
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                    {state === "active" && (
                      <motion.span
                        aria-hidden
                        className="absolute inset-0 rounded-full bg-foreground/20"
                        animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.6, 1] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                      />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-[11px] uppercase tracking-[0.14em] font-medium truncate",
                        state === "pending" ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {step.label}
                    </p>
                    {step.hint && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {step.hint}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
