"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { CohortRow, PillarCoverage } from "@/lib/intelligence/pulse";
import { INSET, KindBadge, Section, TYPE } from "./shared";
import { useIntelligenceFormat } from "./format";

const DIMENSIONS = ["format", "length", "cta", "hashtags"] as const;
const KEYS = ["video", "image", "carousel", "text", "short", "medium", "long", "none", "cta", "question", "none-cta", "0", "1-3", "4+"] as const;

function useCohortLabel() {
  const t = useTranslations("intelligence.cohorts");
  return (row: Pick<CohortRow, "dimension" | "key">) => {
    const key = row.dimension === "cta" && row.key === "none" ? "none-cta" : row.key;
    return (KEYS as readonly string[]).includes(key) ? t(`keys.${key as (typeof KEYS)[number]}`) : row.key;
  };
}

function CohortGroup({ dimension, rows, best }: { dimension: (typeof DIMENSIONS)[number]; rows: CohortRow[]; best: number }) {
  const t = useTranslations("intelligence.cohorts");
  const fmt = useIntelligenceFormat();
  const label = useCohortLabel();
  return (
    <div className={cn("p-4", INSET)}>
      <p className={TYPE.meta}>{t(`dimensions.${dimension}`)}</p>
      <ul className="m-0 mt-3 list-none space-y-3 p-0">
        {rows.map((row) => {
          const width = best > 0 && row.avgEngagements !== null ? Math.max(4, Math.round((row.avgEngagements / best) * 100)) : 0;
          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-medium text-foreground">{label(row)}</span>
                <span className="shrink-0 text-muted-foreground">{t("posts", { count: row.posts })}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card">
                  <div className="h-full origin-left rounded-full bg-mk-accent rtl:origin-right" style={{ transform: `scaleX(${width / 100})`, width: "100%" }} />
                </div>
                <span className={cn("w-16 shrink-0 text-end text-xs", TYPE.figure)} title={t("avgEngagements")}>{fmt.metric(row.avgEngagements)}</span>
                <span className="w-12 shrink-0 text-end text-xs tabular-nums text-muted-foreground" title={t("rate")}>{fmt.rate(row.engagementRate)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CohortsSection({ cohorts, measuredCount }: { cohorts: { rows: CohortRow[]; stopDoing: CohortRow[] }; measuredCount: number }) {
  const t = useTranslations("intelligence.cohorts");
  const fmt = useIntelligenceFormat();
  const label = useCohortLabel();
  const overall = cohorts.rows.length > 0
    ? cohorts.rows.filter((r) => r.dimension === "format").reduce((a, r) => a + (r.avgEngagements ?? 0) * r.posts, 0)
      / Math.max(1, cohorts.rows.filter((r) => r.dimension === "format").reduce((a, r) => a + r.posts, 0))
    : 0;
  return (
    <>
      <Section trust="calculated" title={t("title")} subtitle={t("subtitle")}>
        {measuredCount < 5 ? (
          <p className={cn("m-0", TYPE.hint)}>{t("tooFew")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {DIMENSIONS.map((dimension) => {
              const rows = cohorts.rows.filter((row) => row.dimension === dimension);
              if (rows.length < 2) return null;
              const best = Math.max(...rows.map((row) => row.avgEngagements ?? 0));
              return <CohortGroup key={dimension} dimension={dimension} rows={rows} best={best} />;
            })}
          </div>
        )}
      </Section>

      {cohorts.stopDoing.length > 0 && (
        <Section trust="calculated" title={t("stopTitle")} subtitle={t("stopSubtitle")}>
          <ul className="m-0 -mx-5 list-none divide-y divide-border border-y border-border p-0 sm:-mx-6">
            {cohorts.stopDoing.map((row) => (
              <li key={`${row.dimension}:${row.key}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 sm:px-6">
                <KindBadge tone="rose">{t(`dimensions.${row.dimension}`)}</KindBadge>
                <span className={cn("min-w-0 flex-1", TYPE.body)}>
                  {t("stopRow", { cohort: label(row), value: fmt.metric(row.avgEngagements), overall: fmt.metric(Math.round(overall)) })}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{t("posts", { count: row.posts })}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

export function PillarCoverageSection({ pillars }: { pillars: PillarCoverage[] }) {
  const t = useTranslations("intelligence.pillarCoverage");
  const fmt = useIntelligenceFormat();
  return (
    <Section trust="calculated" title={t("title")} subtitle={t("subtitle")}>
      {pillars.length === 0 ? (
        <p className={cn("m-0", TYPE.hint)}>{t("empty")}</p>
      ) : (
        <div className="divide-y divide-border">
          <div className={cn("hidden grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 pb-3 sm:grid", TYPE.meta)}>
            <span />
            <span className="text-end">{t("last30")}</span>
            <span className="text-end">{t("prior30")}</span>
            <span className="text-end">{t("avg")}</span>
          </div>
          {pillars.map((row) => {
            const cell = (label: string, value: string) => (
              <div className="flex justify-between sm:block sm:text-end">
                <span className="text-xs text-mk-ink-40 sm:hidden">{label}</span>
                <span className={cn("text-sm", TYPE.figure)}>{value}</span>
              </div>
            );
            return (
              <div key={row.pillar} className="grid grid-cols-1 gap-1 py-3 text-xs sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] sm:items-center sm:gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={cn("truncate", TYPE.strong)}>{row.pillar}</span>
                  {row.quiet && <KindBadge tone="amber">{t("quiet")}</KindBadge>}
                </div>
                {cell(t("last30"), fmt.whole(row.last30))}
                {cell(t("prior30"), fmt.whole(row.prior30))}
                {cell(t("avg"), fmt.metric(row.avgEngagements))}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
