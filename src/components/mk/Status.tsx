"use client";

import { useTranslations } from "next-intl";

const DOT: Record<string, string> = {
  published: "var(--mk-pos)",
  scheduled: "var(--mk-ink-60)",
  draft: "var(--mk-ink-20)",
  failed: "var(--mk-neg)",
  active: "var(--mk-pos)",
  paused: "var(--mk-warn)",
  ended: "var(--mk-ink-40)",
  live: "var(--mk-neg)",
  completed: "var(--mk-ink-60)",
  cancelled: "var(--mk-neg)",
};

export function Status({ value, label }: { value: string; label?: string }) {
  const t = useTranslations("appCommon.status");
  const key = value?.toLowerCase();
  const dot = DOT[key] ?? "var(--mk-ink-40)";
  const resolvedLabel = label ?? (key in DOT ? t(key) : value);
  return (
    <span
      className="inline-flex items-center gap-[7px] text-[12px]"
      style={{ color: "var(--mk-ink-80)", letterSpacing: "-0.005em" }}
    >
      <span
        className="inline-block rounded-full"
        style={{ width: 6, height: 6, background: dot }}
      />
      {resolvedLabel}
    </span>
  );
}
