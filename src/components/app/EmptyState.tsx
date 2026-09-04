import { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What is missing, why it matters in one line, and exactly one next action.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-border bg-card text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-3 grid size-10 place-items-center rounded-lg bg-muted text-mk-ink-60">
          <Icon className="size-5" strokeWidth={1.75} />
        </div>
      ) : null}
      <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="m-0 mt-1 max-w-[40ch] text-[13px] leading-5 text-muted-foreground text-pretty">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
