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
    <div className="mb-7 flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
      <div className="min-w-0 flex-1">
        <h1
          className="text-[26px] font-semibold m-0"
          style={{ color: "var(--mk-ink)", letterSpacing: "-0.025em" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="mt-1 text-[13.5px]"
            style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}
