"use client";

import { useTranslations } from "next-intl";

const STATUS_CONFIG: Record<
  string,
  { dot: string; bg: string; text: string; ring?: string }
> = {
  published: {
    dot: "var(--mk-pos)",
    bg: "color-mix(in srgb, var(--mk-pos) 10%, var(--mk-paper))",
    text: "var(--mk-pos)",
    ring: "color-mix(in srgb, var(--mk-pos) 20%, transparent)",
  },
  scheduled: {
    dot: "var(--mk-accent)",
    bg: "var(--mk-accent-soft)",
    text: "var(--mk-accent)",
    ring: "color-mix(in srgb, var(--mk-accent) 20%, transparent)",
  },
  draft: {
    dot: "var(--mk-ink-40)",
    bg: "var(--mk-panel)",
    text: "var(--mk-ink-60)",
    ring: "var(--mk-rule)",
  },
  failed: {
    dot: "var(--mk-neg)",
    bg: "color-mix(in srgb, var(--mk-neg) 10%, var(--mk-paper))",
    text: "var(--mk-neg)",
    ring: "color-mix(in srgb, var(--mk-neg) 20%, transparent)",
  },
  active: {
    dot: "var(--mk-pos)",
    bg: "color-mix(in srgb, var(--mk-pos) 10%, var(--mk-paper))",
    text: "var(--mk-pos)",
    ring: "color-mix(in srgb, var(--mk-pos) 20%, transparent)",
  },
  paused: {
    dot: "var(--mk-warn)",
    bg: "color-mix(in srgb, var(--mk-warn) 10%, var(--mk-paper))",
    text: "var(--mk-warn)",
    ring: "color-mix(in srgb, var(--mk-warn) 20%, transparent)",
  },
  ended: {
    dot: "var(--mk-ink-40)",
    bg: "var(--mk-panel)",
    text: "var(--mk-ink-60)",
    ring: "var(--mk-rule)",
  },
  live: {
    dot: "var(--mk-neg)",
    bg: "color-mix(in srgb, var(--mk-neg) 10%, var(--mk-paper))",
    text: "var(--mk-neg)",
    ring: "color-mix(in srgb, var(--mk-neg) 20%, transparent)",
  },
  completed: {
    dot: "var(--mk-ink-60)",
    bg: "var(--mk-panel)",
    text: "var(--mk-ink-80)",
    ring: "var(--mk-rule)",
  },
  cancelled: {
    dot: "var(--mk-neg)",
    bg: "color-mix(in srgb, var(--mk-neg) 10%, var(--mk-paper))",
    text: "var(--mk-neg)",
    ring: "color-mix(in srgb, var(--mk-neg) 20%, transparent)",
  },
};

export function Status({
  value,
  label,
  variant = "pill",
}: {
  value: string;
  label?: string;
  variant?: "pill" | "dot";
}) {
  const t = useTranslations("appCommon.status");
  const key = value?.toLowerCase();
  const conf = STATUS_CONFIG[key] ?? {
    dot: "var(--mk-ink-40)",
    bg: "var(--mk-panel)",
    text: "var(--mk-ink-60)",
    ring: "var(--mk-rule)",
  };
  const resolvedLabel = label ?? (key in STATUS_CONFIG ? t(key) : value);

  if (variant === "dot") {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[12px] font-medium"
        style={{ color: "var(--mk-ink-80)" }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full shadow-xs"
          style={{ background: conf.dot }}
        />
        {resolvedLabel}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors"
      style={{
        background: conf.bg,
        color: conf.text,
        border: `1px solid ${conf.ring}`,
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: conf.dot }}
      />
      {resolvedLabel}
    </span>
  );
}

