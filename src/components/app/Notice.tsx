import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: { box: "border-border bg-card", icon: "text-mk-ink-60" },
  accent: { box: "border-mk-accent/30 bg-mk-accent-soft", icon: "text-mk-accent" },
  positive: { box: "border-mk-pos/30 bg-mk-pos-soft", icon: "text-mk-pos" },
  warning: { box: "border-mk-warn/30 bg-mk-warn-soft", icon: "text-mk-warn" },
  negative: { box: "border-mk-neg/30 bg-mk-neg-soft", icon: "text-mk-neg" },
} as const;

/**
 * Inline notice placed where the thing it describes happens: a failed load
 * above the content it replaces, a first-run prompt above an empty grid.
 */
export default function Notice({
  tone = "neutral",
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "negative" ? "alert" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between",
        t.box,
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? <Icon className={cn("mt-0.5 size-4 shrink-0", t.icon)} aria-hidden /> : null}
        <div className="min-w-0">
          {title ? <p className="m-0 text-sm font-semibold text-foreground">{title}</p> : null}
          {children ? (
            <div className={cn("text-[13px] leading-5 text-mk-ink-80 text-pretty", title && "mt-0.5")}>{children}</div>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2 sm:ps-4">{action}</div> : null}
    </div>
  );
}
