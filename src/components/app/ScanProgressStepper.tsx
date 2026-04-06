"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Globe, FileSearch, Palette, Sparkles, PackageCheck, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScanPhase } from "@/hooks/useProductScan";

type Step = {
  phase: ScanPhase;
  label: string;
  activeLabel: string;
  icon: React.ElementType;
};

const STEPS: Step[] = [
  { phase: "connecting", label: "Connect to site", activeLabel: "Connecting to site…", icon: Globe },
  { phase: "reading", label: "Read website content", activeLabel: "Reading website content…", icon: FileSearch },
  { phase: "extracting", label: "Extract brand colours", activeLabel: "Extracting brand colours & logo…", icon: Palette },
  { phase: "analyzing", label: "Analyse with AI", activeLabel: "Analysing with AI…", icon: Sparkles },
  { phase: "finalizing", label: "Build product profile", activeLabel: "Building your product profile…", icon: PackageCheck },
];

const PHASE_ORDER: Record<string, number> = {
  idle: -1,
  connecting: 0,
  reading: 1,
  extracting: 2,
  analyzing: 3,
  finalizing: 4,
  done: 5,
  error: 99,
};

function getStepState(stepPhase: ScanPhase, currentPhase: ScanPhase): "pending" | "active" | "done" {
  const stepIdx = PHASE_ORDER[stepPhase] ?? -1;
  const currentIdx = PHASE_ORDER[currentPhase] ?? -1;

  if (currentPhase === "done") return "done";
  if (currentPhase === "error") {
    return stepIdx < currentIdx ? "done" : stepIdx === currentIdx ? "active" : "pending";
  }
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

export default function ScanProgressStepper({
  phase,
  url,
  compact = false,
}: {
  phase: ScanPhase;
  url?: string;
  compact?: boolean;
}) {
  if (phase === "idle") return null;

  const isDone = phase === "done";
  const isError = phase === "error";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "rounded-xl border bg-muted/30 overflow-hidden",
        compact ? "p-4" : "p-5",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-4">
        {isDone ? (
          <div className="h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center">
            <Check className="h-3.5 w-3.5 text-white" />
          </div>
        ) : isError ? (
          <div className="h-6 w-6 rounded-full bg-destructive flex items-center justify-center">
            <AlertCircle className="h-3.5 w-3.5 text-white" />
          </div>
        ) : (
          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              className="h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-medium truncate",
            isDone && "text-emerald-600",
            isError && "text-destructive",
          )}>
            {isDone
              ? "Scan complete — review and confirm below"
              : isError
                ? "Scan failed — please fill in manually"
                : "Researching your product…"}
          </p>
          {url && !isDone && !isError && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{url}</p>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className={cn("space-y-1", compact && "space-y-0.5")}>
        <AnimatePresence mode="popLayout">
          {STEPS.map((step, i) => {
            const state = getStepState(step.phase, phase);
            const Icon = step.icon;

            return (
              <motion.div
                key={step.phase}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: i * 0.06 }}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors duration-300",
                  state === "active" && "bg-primary/5",
                  state === "done" && "opacity-60",
                  state === "pending" && "opacity-30",
                )}
              >
                {/* Icon */}
                <div className={cn(
                  "h-5 w-5 flex items-center justify-center shrink-0",
                  state === "active" && "text-primary",
                  state === "done" && "text-emerald-500",
                  state === "pending" && "text-muted-foreground",
                )}>
                  {state === "done" ? (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 400, damping: 15 }}
                    >
                      <Check className="h-4 w-4" />
                    </motion.div>
                  ) : state === "active" ? (
                    <motion.div
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    >
                      <Icon className="h-4 w-4" />
                    </motion.div>
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>

                {/* Label */}
                <span className={cn(
                  "text-xs",
                  state === "active" && "text-foreground font-medium",
                  state === "done" && "text-muted-foreground",
                  state === "pending" && "text-muted-foreground",
                )}>
                  {state === "active" ? step.activeLabel : step.label}
                </span>

                {/* Active pulse dot */}
                {state === "active" && (
                  <motion.span
                    className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
