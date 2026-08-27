"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarDays, PenSquare } from "lucide-react";
import {
  CompassIcon,
  DecisionButtons,
  DraftButton,
  EmptyState,
  KindBadge,
  PhaseGate,
  Section,
  StatusFilterBar,
  TabHeader,
  phasesOf,
  type StatusFilter,
} from "./shared";
import { useIntelligenceCopy } from "./copy";
import type { DecisionStatus, IntelligenceOverview, OpportunityRow } from "./types";

function OpportunityCard({ item, productId }: { item: OpportunityRow; productId: string }) {
  const t = useTranslations("intelligence");
  const copy = useIntelligenceCopy();
  const [status, setStatus] = useState<DecisionStatus>(item.status || "proposed");
  const rendered = copy.opportunity(item);
  const platform = item.params?.kind === "platform" ? item.params.leader : undefined;
  return (
    <Section trust="recommended" eyebrow={rendered.kind} title={rendered.title}>
      <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">{rendered.body}</p>
      {rendered.evidence && (
        <div className="mt-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5 text-[12px] leading-relaxed dark:border-slate-800 dark:bg-slate-900/60">
          <KindBadge tone="emerald">{t("opportunities.evidenceLabel")}</KindBadge>
          <p className="mt-1.5 text-slate-600 dark:text-slate-400">{rendered.evidence}</p>
        </div>
      )}
      {status !== "dismissed" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <DraftButton productId={productId} source={{ type: "opportunity", id: item.id }} platform={platform} />
          <Link
            href="/content"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <PenSquare className="h-3.5 w-3.5" aria-hidden="true" />
            {t("opportunities.composeInContent")}
          </Link>
          <Link
            href="/calendar"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            {t("opportunities.openCalendar")}
          </Link>
        </div>
      )}
      <DecisionButtons
        path={`/api/intelligence/recommendations/${item.id}/decision`}
        productId={productId}
        status={item.status}
        kind="opportunity"
        onChanged={setStatus}
      />
    </Section>
  );
}

export function OpportunitiesTab({ data, productId }: { data: IntelligenceOverview; productId: string }) {
  const t = useTranslations("intelligence");
  const phases = phasesOf(data);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = { all: 0, proposed: 0, accepted: 0, pinned: 0, dismissed: 0 };
    for (const item of data.opportunities) {
      const status = (item.status || "proposed") as DecisionStatus;
      base[status] += 1;
      if (status !== "dismissed") base.all += 1;
    }
    return base;
  }, [data.opportunities]);
  const visible = data.opportunities.filter((item) => {
    const status = item.status || "proposed";
    return filter === "all" ? status !== "dismissed" : status === filter;
  });

  return (
    <div className="space-y-4 sm:space-y-5">
      <TabHeader topic="opportunities" title={t("howItWorks.opportunities.title")} body={t("howItWorks.opportunities.intro")} />
      <PhaseGate enabled={phases.growth} feature="intelligenceOptimization">
        {data.opportunities.length === 0 ? (
          <EmptyState icon={CompassIcon} title={t("empty.opportunitiesTitle")} body={t("empty.opportunitiesBody")} />
        ) : (
          <>
            <StatusFilterBar value={filter} onChange={setFilter} counts={counts} />
            {visible.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("filter.none")}</p>
            ) : (
              visible.map((item) => <OpportunityCard key={item.id} item={item} productId={productId} />)
            )}
          </>
        )}
      </PhaseGate>
    </div>
  );
}
