"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDashed } from "lucide-react";
import type { IntelligenceReadiness, ReadinessCheckId } from "@/lib/intelligence/readiness";
import { Section, TYPE } from "./shared";
import { useIntelligenceFormat } from "./format";
import { cn } from "@/lib/utils";

/** Audience alignment is left out: no connected platform supplies it yet. */
const ORDER: ReadinessCheckId[] = [
  "history",
  "contentPatterns",
  "learnings",
  "platformComparison",
  "timing",
  "timingWindow",
];

export function ReadinessPanel({
  readiness,
  objectiveMetric,
}: {
  readiness: IntelligenceReadiness;
  objectiveMetric: string;
}) {
  const t = useTranslations("intelligence.readiness");
  const fmt = useIntelligenceFormat();
  const checks = ORDER
    .map((id) => readiness.checks.find((check) => check.id === id))
    .filter((check): check is NonNullable<typeof check> => Boolean(check) && check!.available);
  const met = checks.filter((check) => check.met).length;

  return (
    <Section
      trust="calculated"
      title={t("title")}
      subtitle={t("subtitle")}
      help="overview"
      action={<span className={cn(TYPE.hint, "tabular-nums")}>{t("summary", { met, total: checks.length })}</span>}
    >
      <ul className="divide-y divide-border">
        {checks.map((check) => {
          const ratio = check.required > 0 ? Math.min(1, check.current / check.required) : 0;
          const Icon = check.met ? CheckCircle2 : CircleDashed;
          return (
            <li key={check.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <Icon
                  className={cn("mt-0.5 size-4 shrink-0", check.met ?"text-mk-pos" :"text-mk-warn")}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className={TYPE.strong}>{t(`checks.${check.id}.label`)}</p>
                  <p className={TYPE.hint}>
                    {check.met
                      ? t(`checks.${check.id}.on`)
                      : t(`checks.${check.id}.hint`, { metric: fmt.metricName(objectiveMetric), missing: Math.max(0, check.required - check.current) })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 sm:w-56">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-[width]", check.met ?"bg-mk-pos" :"bg-mk-warn")}
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
                <span className={cn("w-16 shrink-0 text-end text-xs tabular-nums", check.met ?"font-semibold text-mk-pos" :"text-muted-foreground")}>
                  {check.met ? t("met") : t("progress", { current: check.current, required: check.required })}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
