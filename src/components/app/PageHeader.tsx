import { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 sm:mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between pb-6 sm:pb-8 border-b border-border/40">
      <div>
        <h2 className="text-2xl sm:text-3xl font-normal tracking-tight font-[family-name:var(--font-display)] text-foreground">{title}</h2>
        <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action ? <div className="flex items-center gap-3">{action}</div> : null}
    </div>
  );
}
