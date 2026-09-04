import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-muted text-foreground",
  accent: "bg-mk-accent-soft text-foreground",
  warn: "bg-mk-warn-soft text-foreground",
  negative: "bg-mk-neg-soft text-foreground",
} as const;

const ICONS = {
  neutral: "text-mk-ink-60",
  accent: "text-mk-accent",
  warn: "text-mk-warn",
  negative: "text-mk-neg",
} as const;

/**
 * One row under the header for account-level notices. Message on the left,
 * at most two actions on the right; wraps on narrow screens.
 */
export function ShellBanner({
  tone = "neutral",
  icon: Icon,
  children,
  action,
  role,
  className,
}: {
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  role?: string;
  className?: string;
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2 text-[13px] leading-5 sm:px-6 lg:px-8",
        TONES[tone],
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon className={cn("size-4 shrink-0", ICONS[tone])} aria-hidden /> : null}
        <div className="min-w-0">{children}</div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
