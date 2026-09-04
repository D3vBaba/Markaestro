import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page title row. Title on the left, actions on the right; on small screens
 * actions wrap under the title. Children (tabs, filters) render below the
 * title on the same rhythm.
 */
export default function PageHeader({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-8 flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-xl font-semibold tracking-tight text-foreground text-balance">
            {title}
          </h1>
          {subtitle ? (
            <p className="m-0 mt-1 max-w-[60ch] text-[13px] leading-5 text-muted-foreground text-pretty">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {action}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
