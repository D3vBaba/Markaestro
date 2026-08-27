import { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 sm:mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-balance text-slate-900 dark:text-slate-50 m-0">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-pretty text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        )}
      </div>
      {action ? (
        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap shrink-0">
          {action}
        </div>
      ) : null}
    </div>
  );
}

