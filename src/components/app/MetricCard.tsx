"use client";

import { useTranslations } from "next-intl";
import { Delta } from "@/components/mk/Delta";

export default function MetricCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  const t = useTranslations("appCommon.metricCard");
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5">
      <div className="mk-label">{label}</div>
      <div className="mk-figure mt-1.5 text-2xl font-semibold text-foreground">{value}</div>
      {typeof delta === "number" ? (
        <p className="m-0 mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Delta value={delta} />
          {t("vsLastPeriod")}
        </p>
      ) : null}
    </div>
  );
}
