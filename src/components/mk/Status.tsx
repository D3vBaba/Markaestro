"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type Tone = "pos" | "neg" | "warn" | "accent" | "neutral" | "ink";

const STATUS_TONE: Record<string, Tone> = {
  published: "pos",
  active: "pos",
  scheduled: "accent",
  draft: "neutral",
  ended: "neutral",
  completed: "ink",
  paused: "warn",
  failed: "neg",
  live: "neg",
  cancelled: "neg",
};

const TONE_CHIP: Record<Tone, string> = {
  pos: "bg-mk-pos-soft text-mk-pos",
  neg: "bg-mk-neg-soft text-mk-neg",
  warn: "bg-mk-warn-soft text-mk-warn",
  accent: "bg-mk-accent-soft text-mk-accent",
  neutral: "bg-muted text-muted-foreground",
  ink: "bg-muted text-mk-ink-80",
};

const TONE_DOT: Record<Tone, string> = {
  pos: "bg-mk-pos",
  neg: "bg-mk-neg",
  warn: "bg-mk-warn",
  accent: "bg-mk-accent",
  neutral: "bg-mk-ink-40",
  ink: "bg-mk-ink-60",
};

/**
 * Semantic state chip. The chip carries its meaning in colour and label; a
 * dot is only drawn in the inline `dot` variant, where the chip would be
 * too loud (table cells, list rows).
 */
export function Status({
  value,
  label,
  variant = "pill",
  className,
}: {
  value: string;
  label?: string;
  variant?: "pill" | "dot";
  className?: string;
}) {
  const t = useTranslations("appCommon.status");
  const key = value?.toLowerCase();
  const tone = STATUS_TONE[key] ?? "neutral";
  const resolvedLabel = label ?? (key in STATUS_TONE ? t(key) : value);

  if (variant === "dot") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium text-mk-ink-80", className)}>
        <span className={cn("inline-block size-1.5 rounded-full", TONE_DOT[tone])} />
        {resolvedLabel}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11.5px] leading-4 font-medium whitespace-nowrap",
        TONE_CHIP[tone],
        className,
      )}
    >
      {resolvedLabel}
    </span>
  );
}
