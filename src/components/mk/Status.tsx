const MAP: Record<string, { dot: string; label: string }> = {
  published: { dot: "var(--mk-pos)",    label: "Published" },
  scheduled: { dot: "var(--mk-ink-60)", label: "Scheduled" },
  draft:     { dot: "var(--mk-ink-20)", label: "Draft" },
  failed:    { dot: "var(--mk-neg)",    label: "Failed" },
  active:    { dot: "var(--mk-pos)",    label: "Active" },
  paused:    { dot: "var(--mk-warn)",   label: "Paused" },
  ended:     { dot: "var(--mk-ink-40)", label: "Ended" },
  live:      { dot: "var(--mk-neg)",    label: "Live" },
  completed: { dot: "var(--mk-ink-60)", label: "Completed" },
  cancelled: { dot: "var(--mk-neg)",    label: "Cancelled" },
};

export function Status({ value, label }: { value: string; label?: string }) {
  const key = value?.toLowerCase();
  const s = MAP[key] || { dot: "var(--mk-ink-40)", label: label ?? value };
  return (
    <span
      className="inline-flex items-center gap-[7px] text-[12px]"
      style={{ color: "var(--mk-ink-80)", letterSpacing: "-0.005em" }}
    >
      <span
        className="inline-block rounded-full"
        style={{ width: 6, height: 6, background: s.dot }}
      />
      {label ?? s.label}
    </span>
  );
}
