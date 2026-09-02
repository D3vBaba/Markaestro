"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  ChannelDot,
  CompassIcon,
  DecisionButtons,
  DraftButton,
  EmptyState,
  INSET,
  KindBadge,
  LightbulbIcon,
  PhaseGate,
  Section,
  StatusFilterBar,
  TYPE,
  countByStatus,
  filterByStatus,
  phasesOf,
  type StatusFilter,
} from "./shared";
import { useIntelligenceCopy } from "./copy";
import { useIntelligenceFormat } from "./format";
import type { DecisionStatus, IntelligenceOverview, LearningRow, OpportunityRow, PostRow } from "./types";

function OpportunityItem({ item, productId }: { item: OpportunityRow; productId: string }) {
  const t = useTranslations("intelligence");
  const copy = useIntelligenceCopy();
  const [status, setStatus] = useState<DecisionStatus>(item.status || "proposed");
  const rendered = copy.opportunity(item);
  const platform = item.params?.kind === "platform" ? item.params.leader : undefined;
  return (
    <li className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge tone="blue">{rendered.kind}</KindBadge>
      </div>
      <h3 className={cn("mt-2", TYPE.cardTitle)}>{rendered.title}</h3>
      <p className={cn("mt-1 max-w-3xl", TYPE.body)}>{rendered.body}</p>
      {rendered.evidence && (
        <p className={cn("mt-3 max-w-3xl px-3 py-2", INSET, TYPE.hint)}>
          <span className="font-semibold text-slate-700 dark:text-slate-200">{t("opportunities.evidenceLabel")}: </span>
          {rendered.evidence}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {status !== "dismissed" && (
          <DraftButton productId={productId} source={{ type: "opportunity", id: item.id }} platform={platform} />
        )}
        <DecisionButtons
          path={`/api/intelligence/recommendations/${item.id}/decision`}
          productId={productId}
          status={item.status}
          kind="opportunity"
          onChanged={setStatus}
        />
      </div>
    </li>
  );
}

function EvidencePosts({ ids, posts, metric }: { ids: string[]; posts: PostRow[]; metric: string }) {
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();
  const byId = new Map(posts.map((post) => [post.id, post]));
  const rows = ids.map((id) => byId.get(id)).filter((post): post is PostRow => Boolean(post)).slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <div className={cn("mt-3 max-w-3xl px-3 py-2.5", INSET)}>
      <p className={TYPE.meta}>{t("learnings.evidenceTitle")}</p>
      <ul className="mt-1.5 divide-y divide-slate-200/70 dark:divide-slate-700/60">
        {rows.map((post) => (
          <li key={post.id} className="flex items-center gap-3 py-1.5">
            <ChannelDot platform={post.platform} className="w-24 shrink-0" />
            <span className={cn("min-w-0 flex-1 truncate", TYPE.hint)}>{post.content || t("content.mediaOnly")}</span>
            <span className={cn("shrink-0 text-xs", TYPE.figure)} title={fmt.metricName(metric)}>{fmt.metric(post.objectiveValue ?? post.views)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LearningItem({ item, productId, posts }: { item: LearningRow; productId: string; posts: PostRow[] }) {
  const copy = useIntelligenceCopy();
  const [status, setStatus] = useState<DecisionStatus>(item.status || "proposed");
  const rendered = copy.learning(item);
  const platform = item.dimension === "platform" ? item.key : undefined;
  const up = (item.effectPercent ?? 0) >= 0;
  return (
    <li className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge tone="slate">{rendered.dimension}</KindBadge>
        <KindBadge tone={item.strength === "potentially_strong" ? "emerald" : item.strength === "moderate" ? "blue" : "amber"} title={rendered.strengthHint}>
          {rendered.strength}
        </KindBadge>
        <span className={TYPE.hint}>{rendered.strengthHint}</span>
      </div>
      <h3 className={cn("mt-2 flex flex-wrap items-baseline gap-x-3", TYPE.cardTitle)}>
        <span>{rendered.key}</span>
        {item.effectPercent !== null && (
          <span className={cn("text-lg", TYPE.figure, up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {up ? "+" : ""}{Math.round(item.effectPercent)}%
          </span>
        )}
      </h3>
      <p className={cn("mt-1 max-w-3xl", TYPE.body)}>{rendered.summary}</p>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {[rendered.comparison, rendered.sample, rendered.interval].map((value) => (
          <div key={value} className="flex items-baseline gap-1.5">
            <dt className="sr-only">{value}</dt>
            <dd className={TYPE.hint}>{value}</dd>
          </div>
        ))}
      </dl>
      <EvidencePosts ids={item.evidencePostIds} posts={posts} metric={item.metric} />
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {status !== "dismissed" && (
          <DraftButton productId={productId} source={{ type: "learning", id: item.id }} platform={platform} />
        )}
        <DecisionButtons
          path={`/api/intelligence/learnings/${item.id}/decision`}
          productId={productId}
          status={item.status}
          kind="learning"
          onChanged={setStatus}
        />
      </div>
    </li>
  );
}

export function PlaybookTab({ data, productId }: { data: IntelligenceOverview; productId: string }) {
  const t = useTranslations("intelligence");
  const phases = phasesOf(data);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const posts = data.measuredPosts?.length ? data.measuredPosts : data.topContent;
  const counts = countByStatus([...data.opportunities, ...data.learnings]);
  const moves = filterByStatus(data.opportunities, filter);
  const patterns = filterByStatus(data.learnings, filter);
  const patternCheck = data.readiness?.checks.find((check) => check.id === "contentPatterns");
  const learningsCheck = data.readiness?.checks.find((check) => check.id === "learnings");
  const hasAnything = data.opportunities.length > 0 || data.learnings.length > 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PhaseGate enabled={phases.learning} feature="intelligenceOptimization">
        {hasAnything && <StatusFilterBar value={filter} onChange={setFilter} counts={counts} />}

        {phases.growth && (
          <Section trust="recommended" title={t("opportunities.title")} subtitle={t("opportunities.subtitle")} help="opportunities">
            {data.opportunities.length === 0 ? (
              <EmptyState icon={CompassIcon} title={t("empty.opportunitiesTitle")} body={t("empty.opportunitiesBody")} />
            ) : moves.length === 0 ? (
              <p className={TYPE.hint}>{t("filter.none")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {moves.map((item) => <OpportunityItem key={item.id} item={item} productId={productId} />)}
              </ul>
            )}
          </Section>
        )}

        <Section trust="calculated" title={t("learnings.title")} subtitle={t("learnings.subtitle")} help="playbook">
          {patternCheck && !patternCheck.met && (
            <p className={cn("mb-4 px-3 py-2", INSET, TYPE.hint)}>
              {t("learnings.contentPatternsNote", { required: patternCheck.required, current: data.readiness?.fingerprinted ?? patternCheck.current })}
            </p>
          )}
          {data.learnings.length === 0 ? (
            <EmptyState
              icon={LightbulbIcon}
              title={t("empty.playbookTitle")}
              body={t("empty.playbookBody")}
              next={learningsCheck && !learningsCheck.met
                ? t("empty.playbookNext", { missing: Math.max(0, learningsCheck.required - learningsCheck.current) })
                : undefined}
            />
          ) : patterns.length === 0 ? (
            <p className={TYPE.hint}>{t("filter.none")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {patterns.map((item) => <LearningItem key={item.id} item={item} productId={productId} posts={posts} />)}
            </ul>
          )}
        </Section>
      </PhaseGate>
    </div>
  );
}
