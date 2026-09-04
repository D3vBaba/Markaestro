"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { WeeklyPulse } from "@/lib/intelligence/pulse";
import { Section, TYPE } from "./shared";
import { useIntelligenceFormat } from "./format";

function Cell({ label, value, delta, noPrior }: { label: string; value: string; delta: number | null; noPrior: string }) {
  const t = useTranslations("intelligence.weekPulse");
  const fmt = useIntelligenceFormat();
  return (
    <div className="min-w-0">
      <p className="mk-label">{label}</p>
      <p className={cn("m-0 mt-1 text-2xl", TYPE.figure)}>{value}</p>
      {delta === null ? (
        <p className={cn("m-0 mt-1", TYPE.hint)}>{noPrior}</p>
      ) : (
        <p className={cn("m-0 mt-1 text-xs font-semibold tabular-nums", delta > 0 ? "text-mk-pos" : delta < 0 ? "text-mk-neg" : "text-muted-foreground")}>
          {fmt.signedPercent(delta)} <span className="font-normal text-muted-foreground">{t("vsLastWeek")}</span>
        </p>
      )}
    </div>
  );
}

/** Three figures for the week, each with its direction against the week before. */
export function WeekPulse({ pulse, objectiveMetric }: { pulse: WeeklyPulse; objectiveMetric: string }) {
  const t = useTranslations("intelligence.weekPulse");
  const fmt = useIntelligenceFormat();
  const noPrior = t("noPrior");
  const showObjective = objectiveMetric !== "views" && objectiveMetric !== "engagements" && pulse.thisWeek.objective !== null;
  return (
    <Section trust="measured" title={t("title")} subtitle={t("subtitle")}>
      {pulse.thisWeek.posts === 0 ? (
        <p className={cn("m-0", TYPE.hint)}>{t("quiet")}</p>
      ) : (
        <div className={cn("grid grid-cols-2 gap-x-4 gap-y-5", showObjective ? "md:grid-cols-4" : "md:grid-cols-3")}>
          <Cell label={t("posts")} value={fmt.whole(pulse.thisWeek.posts)} delta={pulse.delta.posts} noPrior={noPrior} />
          <Cell label={t("views")} value={fmt.metric(pulse.thisWeek.views)} delta={pulse.delta.views} noPrior={noPrior} />
          <Cell label={t("engagements")} value={fmt.metric(pulse.thisWeek.engagements)} delta={pulse.delta.engagements} noPrior={noPrior} />
          {showObjective && (
            <Cell label={fmt.metricName(objectiveMetric)} value={fmt.metric(pulse.thisWeek.objective)} delta={pulse.delta.objective} noPrior={noPrior} />
          )}
        </div>
      )}
    </Section>
  );
}
