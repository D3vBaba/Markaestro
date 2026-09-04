"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DecisionOutcome } from "@/lib/intelligence/pulse";
import { cn } from "@/lib/utils";
import { Channel } from "@/components/mk/Channel";
import Pagination from "@/components/app/Pagination";
import {
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
import type { DecisionStatus, ExperimentDraft, ExperimentResultRow, IntelligenceOverview, LearningRow, OpportunityRow, PostRow } from "./types";
import { channelLabel } from "@/components/mk/channels";

/** What happened after the team said yes: measuring, or a before/after figure. */
function OutcomeBadge({ outcome, metric }: { outcome: DecisionOutcome; metric: string }) {
  const t = useTranslations("intelligence.outcomes");
  const fmt = useIntelligenceFormat();
  if (!outcome.ready) {
    return <KindBadge tone="slate">{t("measuring", { count: outcome.sampleAfter, date: fmt.date(outcome.decidedAt) ?? "" })}</KindBadge>;
  }
  if (outcome.sampleAfter === 0) return <KindBadge tone="slate">{t("noPosts")}</KindBadge>;
  if (outcome.changePct === null || Math.abs(outcome.changePct) < 3) return <KindBadge tone="slate">{t("flat")}</KindBadge>;
  return (
    <KindBadge tone={outcome.changePct > 0 ? "emerald" : "rose"}>
      {t("result", { value: fmt.signedPercent(outcome.changePct), metric: fmt.metricName(metric) })}
    </KindBadge>
  );
}

function TestButton({ onTest, draft }: { onTest?: (draft: ExperimentDraft) => void; draft: ExperimentDraft }) {
  const t = useTranslations("intelligence.outcomes");
  if (!onTest) return null;
  return (
    <Button variant="ghost" size="sm" onClick={() => onTest(draft)}>
      <FlaskConical className="size-3.5" aria-hidden="true" />
      {t("testThis")}
    </Button>
  );
}

/** Collapsed by default: the claim and the figure carry the row, the proof is one tap away. */
function Evidence({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        {label}
      </button>
      {open ? <div className={cn("mt-2 p-3", INSET)}>{children}</div> : null}
    </div>
  );
}

/**
 * Row layout shared by moves and patterns: labels, title and body on the
 * left; the headline figure on the right; actions along the bottom.
 */
function PlaybookRow({
  labels,
  title,
  figure,
  figureTone,
  body,
  meta,
  evidence,
  evidenceLabel,
  actions,
}: {
  labels: React.ReactNode;
  title: React.ReactNode;
  figure?: string;
  figureTone?: "pos" | "neg";
  body: string;
  meta?: string[];
  evidence?: React.ReactNode;
  evidenceLabel?: string;
  actions: React.ReactNode;
}) {
  return (
    <li className="px-5 py-6 sm:px-6">
      <div className={cn("grid gap-4", figure ? "grid-cols-[minmax(0,1fr)_auto] items-start" : "grid-cols-1")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">{labels}</div>
          <h3 className={cn("m-0 mt-2 text-[15px] font-semibold leading-5 text-foreground")}>{title}</h3>
          <p className={cn("m-0 mt-1 max-w-[70ch]", TYPE.body)}>{body}</p>
          {meta && meta.length > 0 ? (
            <p className={cn("m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1", TYPE.hint)}>
              {meta.map((item) => <span key={item}>{item}</span>)}
            </p>
          ) : null}
          {evidence && evidenceLabel ? <Evidence label={evidenceLabel}>{evidence}</Evidence> : null}
        </div>
        {figure ? (
          <div className="text-right md:w-28">
            <span className={cn("mk-figure text-xl font-semibold md:text-2xl", figureTone === "neg" ? "text-mk-neg" : "text-mk-pos")}>{figure}</span>
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">{actions}</div>
    </li>
  );
}

function OpportunityItem({ item, productId, outcome, metric, onTest }: { item: OpportunityRow; productId: string; outcome?: DecisionOutcome; metric: string; onTest?: (draft: ExperimentDraft) => void }) {
  const t = useTranslations("intelligence");
  const copy = useIntelligenceCopy();
  const [status, setStatus] = useState<DecisionStatus>(item.status || "proposed");
  const rendered = copy.opportunity(item);
  const platform = item.params?.kind === "platform" ? item.params.leader : undefined;
  return (
    <PlaybookRow
      labels={
        <>
          <KindBadge tone="blue">{rendered.kind}</KindBadge>
          {outcome && status !== "dismissed" && <OutcomeBadge outcome={outcome} metric={metric} />}
        </>
      }
      title={rendered.title}
      body={rendered.body}
      evidenceLabel={rendered.evidence ? t("opportunities.evidenceLabel") : undefined}
      evidence={rendered.evidence ? <p className={cn("m-0", TYPE.body)}>{rendered.evidence}</p> : undefined}
      actions={
        <>
          {status !== "dismissed" && (
            <DraftButton productId={productId} source={{ type: "opportunity", id: item.id }} platform={platform} />
          )}
          {status !== "dismissed" && (
            <TestButton onTest={onTest} draft={{ id: `opportunity:${item.id}`, name: rendered.title, hypothesis: rendered.body, platform }} />
          )}
          <DecisionButtons
            path={`/api/intelligence/recommendations/${item.id}/decision`}
            productId={productId}
            status={item.status}
            kind="opportunity"
            onChanged={setStatus}
          />
        </>
      }
    />
  );
}

function EvidencePosts({ ids, posts, metric }: { ids: string[]; posts: PostRow[]; metric: string }) {
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();
  const byId = new Map(posts.map((post) => [post.id, post]));
  const rows = ids.map((id) => byId.get(id)).filter((post): post is PostRow => Boolean(post)).slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <ul className="m-0 list-none divide-y divide-border p-0">
      {rows.map((post) => (
        <li key={post.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
          <Channel channel={post.platform} size={18} />
          <span className={cn("min-w-0 flex-1 truncate", TYPE.body)}>{post.content || t("content.mediaOnly")}</span>
          <span className={cn("shrink-0 text-xs", TYPE.figure)} title={fmt.metricName(metric)}>{fmt.metric(post.objectiveValue ?? post.views)}</span>
        </li>
      ))}
    </ul>
  );
}

function LearningItem({ item, productId, posts, outcome, onTest }: { item: LearningRow; productId: string; posts: PostRow[]; outcome?: DecisionOutcome; onTest?: (draft: ExperimentDraft) => void }) {
  const t = useTranslations("intelligence");
  const copy = useIntelligenceCopy();
  const [status, setStatus] = useState<DecisionStatus>(item.status || "proposed");
  const rendered = copy.learning(item);
  const platform = item.dimension === "platform" ? item.key : undefined;
  const up = (item.effectPercent ?? 0) >= 0;
  const hasEvidence = item.evidencePostIds.length > 0;
  return (
    <PlaybookRow
      labels={
        <>
          <KindBadge tone="slate">{rendered.dimension}</KindBadge>
          <KindBadge tone={item.strength === "potentially_strong" ? "emerald" : item.strength === "moderate" ? "blue" : "amber"} title={rendered.strengthHint}>
            {rendered.strength}
          </KindBadge>
          {outcome && status !== "dismissed" && <OutcomeBadge outcome={outcome} metric={item.metric} />}
        </>
      }
      title={rendered.key}
      figure={item.effectPercent !== null ? `${up ? "+" : ""}${Math.round(item.effectPercent)}%` : undefined}
      figureTone={up ? "pos" : "neg"}
      body={rendered.summary}
      meta={[rendered.comparison, rendered.sample, rendered.interval, rendered.strengthHint]}
      evidenceLabel={hasEvidence ? t("learnings.evidenceTitle") : undefined}
      evidence={hasEvidence ? <EvidencePosts ids={item.evidencePostIds} posts={posts} metric={item.metric} /> : undefined}
      actions={
        <>
          {status !== "dismissed" && (
            <DraftButton productId={productId} source={{ type: "learning", id: item.id }} platform={platform} />
          )}
          {status !== "dismissed" && (
            <TestButton onTest={onTest} draft={{ id: `learning:${item.id}`, name: rendered.key, hypothesis: rendered.summary, platform }} />
          )}
          <DecisionButtons
            path={`/api/intelligence/learnings/${item.id}/decision`}
            productId={productId}
            status={item.status}
            kind="learning"
            onChanged={setStatus}
          />
        </>
      }
    />
  );
}

const LIST = "m-0 -mx-5 list-none divide-y divide-border border-y border-border p-0 sm:-mx-6";
const PAGE_SIZE = 5;

function usePaged<T>(items: T[], resetKey: string) {
  const [page, setPage] = useState(1);
  const [pagedFor, setPagedFor] = useState(resetKey);
  if (pagedFor !== resetKey) { setPagedFor(resetKey); setPage(1); }
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  return { page: current, totalPages, setPage, items: items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE) };
}

function ProvenTests({ results }: { results: ExperimentResultRow[] }) {
  const t = useTranslations("intelligence.provenTests");
  const fmt = useIntelligenceFormat();
  const winners = results.filter((row) => row.status === "winner_a" || row.status === "winner_b");
  const inconclusive = results.length - winners.length;
  return (
    <Section trust="measured" title={t("title")} subtitle={t("subtitle")}>
      {winners.length === 0 ? (
        <p className={cn("m-0", TYPE.hint)}>{inconclusive > 0 ? t("inconclusiveCount", { count: inconclusive }) : t("empty")}</p>
      ) : (
        <>
          <ul className={LIST}>
            {winners.map((row) => (
              <li key={row.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-1.5">
                  <KindBadge tone="emerald">{row.status === "winner_a" ? t("winnerA") : t("winnerB")}</KindBadge>
                  {row.platform && <KindBadge tone="slate">{channelLabel(row.platform)}</KindBadge>}
                  {row.reason === "early_stop" && <KindBadge tone="blue">{t("stoppedEarly")}</KindBadge>}
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                  <div className="min-w-0">
                    <p className={cn("m-0", TYPE.strong)}>{row.name}</p>
                    {row.hypothesis && <p className={cn("m-0 mt-0.5 max-w-[70ch]", TYPE.body)}>{row.hypothesis}</p>}
                    {row.evaluatedAt && <p className={cn("m-0 mt-1", TYPE.hint)}>{fmt.date(row.evaluatedAt)}</p>}
                  </div>
                  {row.effectPercent !== null && (
                    <span className={cn("mk-figure text-2xl font-semibold", row.effectPercent >= 0 ? "text-mk-pos" : "text-mk-neg")}>{fmt.signedPercent(row.effectPercent)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {inconclusive > 0 && <p className={cn("m-0 mt-3", TYPE.hint)}>{t("inconclusiveCount", { count: inconclusive })}</p>}
        </>
      )}
    </Section>
  );
}

export function PlaybookTab({ data, productId, onTest }: { data: IntelligenceOverview; productId: string; onTest?: (draft: ExperimentDraft) => void }) {
  const t = useTranslations("intelligence");
  const phases = phasesOf(data);
  const outcomes = data.outcomes ?? {};
  const objectiveMetric = data.objective?.metric || "views";
  const test = phases.experiments ? onTest : undefined;
  const [filter, setFilter] = useState<StatusFilter>("all");
  const posts = data.measuredPosts?.length ? data.measuredPosts : data.topContent;
  const counts = countByStatus([...data.opportunities, ...data.learnings]);
  const moves = filterByStatus(data.opportunities, filter);
  const patterns = filterByStatus(data.learnings, filter);
  const movesPaged = usePaged(moves, `${filter}|${moves.length}`);
  const patternsPaged = usePaged(patterns, `${filter}|${patterns.length}`);
  const patternCheck = data.readiness?.checks.find((check) => check.id === "contentPatterns");
  const learningsCheck = data.readiness?.checks.find((check) => check.id === "learnings");
  const hasAnything = data.opportunities.length > 0 || data.learnings.length > 0;

  return (
    <div className="space-y-6">
      <PhaseGate enabled={phases.learning} feature="intelligenceOptimization">
        {hasAnything && <StatusFilterBar value={filter} onChange={setFilter} counts={counts} />}

        {phases.growth && (
          <Section trust="recommended" title={t("opportunities.title")} subtitle={t("opportunities.subtitle")} help="opportunities">
            {data.opportunities.length === 0 ? (
              <EmptyState icon={CompassIcon} title={t("empty.opportunitiesTitle")} body={t("empty.opportunitiesBody")} />
            ) : moves.length === 0 ? (
              <p className={cn("m-0", TYPE.hint)}>{t("filter.none")}</p>
            ) : (
              <>
                <ul className={LIST}>
                  {movesPaged.items.map((item) => <OpportunityItem key={item.id} item={item} productId={productId} outcome={outcomes[item.id]} metric={objectiveMetric} onTest={test} />)}
                </ul>
                {movesPaged.totalPages > 1 && <Pagination page={movesPaged.page} totalPages={movesPaged.totalPages} onPageChange={movesPaged.setPage} />}
              </>
            )}
          </Section>
        )}

        <Section
          trust="calculated"
          title={t("learnings.title")}
          subtitle={
            patternCheck && !patternCheck.met
              ? t("learnings.contentPatternsNote", { required: patternCheck.required, current: data.readiness?.fingerprinted ?? patternCheck.current })
              : t("learnings.subtitle")
          }
          help="playbook"
        >
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
            <p className={cn("m-0", TYPE.hint)}>{t("filter.none")}</p>
          ) : (
            <>
              <ul className={LIST}>
                {patternsPaged.items.map((item) => <LearningItem key={item.id} item={item} productId={productId} posts={posts} outcome={outcomes[item.id]} onTest={test} />)}
              </ul>
              {patternsPaged.totalPages > 1 && <Pagination page={patternsPaged.page} totalPages={patternsPaged.totalPages} onPageChange={patternsPaged.setPage} />}
            </>
          )}
        </Section>

        {phases.experiments && data.experimentResults && data.experimentResults.length > 0 && (
          <ProvenTests results={data.experimentResults} />
        )}
      </PhaseGate>
    </div>
  );
}
