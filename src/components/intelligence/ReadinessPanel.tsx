"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDashed, CircleOff } from "lucide-react";
import type { IntelligenceReadiness, ReadinessCheckId } from "@/lib/intelligence/readiness";
import { Section } from "./shared";
import { useIntelligenceFormat } from "./format";
import { cn } from "@/lib/utils";

const ORDER: ReadinessCheckId[] = [
  "history",
  "timing",
  "timingWindow",
  "platformComparison",
  "learnings",
  "contentPatterns",
  "alignment",
];

export function ReadinessPanel({
  readiness,
  objectiveMetric,
  computedAt,
}: {
  readiness: IntelligenceReadiness;
  objectiveMetric: string;
  computedAt?: string;
}) {
  const t = useTranslations("intelligence.readiness");
  const fmt = useIntelligenceFormat();
  const checks = ORDER
    .map((id) => readiness.checks.find((check) => check.id === id))
    .filter((check): check is NonNullable<typeof check> => Boolean(check));
  const computed = fmt.dateTime(computedAt);

  return (
    <Section
      trust="calculated"
      title={t("title")}
      subtitle={t("subtitle")}
      help="overview"
      action={computed ? <span className="text-[11px] text-slate-400 dark:text-slate-500">{t("computedAt", { when: computed })}</span> : undefined}
    >
      <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
        {checks.map((check) => {
          const ratio = check.required > 0 ? Math.min(1, check.current / check.required) : 0;
          const state = !check.available ? "unavailable" : check.met ? "met" : "pending";
          const Icon = state === "met" ? CheckCircle2 : state === "pending" ? CircleDashed : CircleOff;
          return (
            <li key={check.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    state === "met"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : state === "pending"
                        ? "text-amber-500"
                        : "text-slate-400",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{t(`checks.${check.id}.label`)}</p>
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {t(`checks.${check.id}.hint`, { metric: fmt.metricName(objectiveMetric) })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 sm:w-64">
                {check.available ? (
                  <>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={cn("h-full rounded-full transition-[width]", check.met ? "bg-emerald-500" : "bg-amber-400")}
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-end font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {t("progress", { current: check.current, required: check.required })}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] font-medium text-slate-400">{t("unavailable")}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
