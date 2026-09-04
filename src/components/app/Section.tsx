import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A titled block of a page. Title row on top, content below. With
 * `bordered` the content sits in one rounded container so related rows can
 * share `divide-y` instead of each becoming a card.
 */
export default function Section({
  title,
  description,
  action,
  bordered = false,
  children,
  className,
  contentClassName,
  id,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  bordered?: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0", className)}>
      {title || action ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="m-0 text-sm font-semibold text-foreground">{title}</h2> : null}
            {description ? (
              <p className="m-0 mt-0.5 text-[13px] leading-5 text-muted-foreground text-pretty">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      <div
        className={cn(
          bordered && "overflow-hidden rounded-xl border border-border bg-card",
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
