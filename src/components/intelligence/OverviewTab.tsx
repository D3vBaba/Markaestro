"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReadinessPanel } from "./ReadinessPanel";
import { AskMarkaestro } from "./AskMarkaestro";
import { WeekPulse } from "./WeekPulse";
import { Channel } from "@/components/mk/Channel";
import { channelLabel } from "@/components/mk/channels";
import { EmptyState, Figure, INSET, PhaseGate, SURFACE, Section, TYPE, phasesOf } from "./shared";
import { useIntelligenceCopy } from "./copy";
import { useIntelligenceFormat } from "./format";
import type { ExperimentDraft, IntelligenceOverview, LearningRow } from "./types";

function strongestLearning(learnings: LearningRow[]): LearningRow | null {
  const rank = { potentially_strong: 3, moderate: 2, directional: 1, insufficient: 0 } as const;
  return [...learnings]
    .filter((item) => (item.status || "proposed") !== "dismissed" && item.effectPercent !== null)
    .sort((a, b) => (rank[b.strength] - rank[a.strength]) || (Math.abs(b.effectPercent ?? 0) - Math.abs(a.effectPercent ?? 0)))[0] ?? null;
}

function BriefingCell({
  label,
  title,
  body,
  cta,
  onOpen,
  muted,
}: {
  label: string;
  title: string;
  body?: string;
  cta: string;
  onOpen: () => void;
  muted?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 p-4", INSET)}>
      <p className={TYPE.meta}>{label}</p>
      <p className={cn(muted ? TYPE.body : TYPE.cardTitle, "text-pretty")}>{title}</p>
      {body && <p className={TYPE.hint}>{body}</p>}
      <button
        type="button"
        onClick={onOpen}
        className="mt-auto inline-flex items-center gap-1 self-start pt-1 text-xs font-semibold text-mk-accent hover:underline"
      >
        {cta}
        <ArrowRight className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
}

export function OverviewTab({
  data,
  onNavigate,
  onTest,
}: {
  data: IntelligenceOverview;
  onNavigate: (tab: string) => void;
  onTest?: (draft: ExperimentDraft) => void;
}) {
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();
  const copy = useIntelligenceCopy();
  const phases = phasesOf(data);
  const totals = data.totals;
  const objective = data.objective;
  const metricName = fmt.metricName(objective?.metric);
  const posts = data.measuredPosts?.length ? data.measuredPosts : data.topContent;
  const engagements = totals
    ? [totals.likes, totals.comments, totals.shares, totals.saves].some((value) => typeof value === "number")
      ? [totals.likes, totals.comments, totals.shares, totals.saves].reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0)
      : null
    : null;
  const coverage = (key: string) => (totals?.coverage[key] !== undefined ? t("coverage", { value: totals.coverage[key] }) : undefined);

  const learning = strongestLearning(data.learnings);
  const move = data.opportunities.find((item) => (item.status || "proposed") === "proposed") ?? data.opportunities.find((item) => item.status !== "dismissed") ?? null;
  const window = data.timing?.windows[0] ?? null;
  const check = (id: string) => data.readiness?.checks.find((item) => item.id === id);
  const learningsCheck = check("learnings");
  const timingCheck = check("timing");
  const timingWindowCheck = check("timingWindow");
  const pendingTiming = timingCheck && !timingCheck.met ? timingCheck : timingWindowCheck && !timingWindowCheck.met ? timingWindowCheck : null;

  if (totals && totals.posts === 0) {
    return (
      <div className="space-y-4 sm:space-y-5">
        <EmptyState title={t("empty.overviewTitle")} body={t("empty.overviewBody")} next={t("empty.overviewNext")} />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <Section
        trust="calculated"
        title={t("briefing.title")}
        subtitle={t("briefing.subtitle", { metric: metricName })}
        help="overview"
        action={
          objective ? (
            <button
              type="button"
              onClick={() => onNavigate("audience")}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-card px-2 text-[11px] font-medium text-mk-ink-80 hover:bg-muted/60"
              title={t("objective.change")}
            >
              <Target className="size-3" aria-hidden="true" />
              {t("objective.title")} {t(`objective.names.${objective.objective}`)}
            </button>
          ) : undefined
        }
      >
        {objective?.fallback && (
          <p className="mb-4 rounded-xl border border-mk-warn/30 bg-mk-warn-soft px-3 py-2 text-xs leading-relaxed text-mk-warn">
            {t("objective.fallback", { requested: t(`objective.names.${objective.requested}`), metric: metricName })}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {learning ? (
            <BriefingCell
              label={t("briefing.pattern")}
              title={copy.learning(learning).title}
              body={copy.learning(learning).summary}
              cta={t("briefing.openPlaybook")}
              onOpen={() => onNavigate("playbook")}
            />
          ) : (
            <BriefingCell
              muted
              label={t("briefing.pattern")}
              title={learningsCheck && !learningsCheck.met
                ? t("briefing.noPattern", { missing: Math.max(0, learningsCheck.required - learningsCheck.current), metric: metricName })
                : t("briefing.noPatternYet")}
              cta={t("briefing.openReadiness")}
              onOpen={() => document.getElementById("intelligence-readiness")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            />
          )}
          {move ? (
            <BriefingCell
              label={t("briefing.move")}
              title={copy.opportunity(move).title}
              body={copy.opportunity(move).body}
              cta={t("briefing.openPlaybook")}
              onOpen={() => onNavigate("playbook")}
            />
          ) : (
            <BriefingCell
              muted
              label={t("briefing.move")}
              title={phases.growth ? t("briefing.noMove") : t("gate.rolloutTitle")}
              cta={t("briefing.openReadiness")}
              onOpen={() => document.getElementById("intelligence-readiness")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            />
          )}
          {window ? (
            <BriefingCell
              label={t("briefing.window")}
              title={fmt.window(window.weekday, window.hour)}
              body={window.liftPercent === null
                ? t("timing.observations", { count: window.observations })
                : `${window.liftPercent >= 0 ? t("timing.liftUp", { value: Math.round(window.liftPercent) }) : t("timing.liftDown", { value: Math.round(window.liftPercent) })} · ${t("timing.observations", { count: window.observations })}`}
              cta={t("briefing.openContent")}
              onOpen={() => onNavigate("content")}
            />
          ) : (
            <BriefingCell
              muted
              label={t("briefing.window")}
              title={pendingTiming
                ? t("briefing.noWindow", { missing: Math.max(0, pendingTiming.required - pendingTiming.current) })
                : t("briefing.noWindowYet")}
              cta={t("briefing.openReadiness")}
              onOpen={() => document.getElementById("intelligence-readiness")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            />
          )}
        </div>
      </Section>

      {data.pulse && <WeekPulse pulse={data.pulse} objectiveMetric={objective?.metric || "views"} />}

      <PhaseGate enabled={phases.strategist !== false && phases.advanced} feature="intelligenceStrategist">
        <AskMarkaestro productId={data.productId || ""} posts={posts} onTest={phases.experiments ? onTest : undefined} />
      </PhaseGate>

      <div className={cn("grid grid-cols-2 gap-x-4 gap-y-5 p-5 sm:p-6 md:grid-cols-3 xl:grid-cols-6", SURFACE)}>
        <Figure label={t("metrics.posts")} value={fmt.whole(totals?.posts ?? 0)} />
        <Figure label={t("metrics.views")} value={fmt.metric(totals?.views)} sub={coverage("views")} />
        <Figure label={t("metrics.reach")} value={fmt.metric(totals?.reach)} sub={coverage("reach")} />
        <Figure label={t("metrics.engagements")} value={fmt.metric(engagements)} sub={coverage("likes")} />
        <Figure label={t("metrics.clicks")} value={fmt.metric(totals?.clicks)} sub={coverage("clicks")} />
        <Figure label={t("metrics.conversions")} value={fmt.metric(totals?.conversions)} sub={coverage("conversions")} />
      </div>

      {data.readiness && (
        <div id="intelligence-readiness" className="scroll-mt-24">
          <ReadinessPanel readiness={data.readiness} objectiveMetric={objective?.metric || "views"} />
        </div>
      )}

      <Section trust="calculated" title={t("platforms.title")} subtitle={t("platforms.subtitle")}>
        {data.channels.length === 0 ? (
          <p className={TYPE.hint}>{t("platforms.empty")}</p>
        ) : (
          <div className="divide-y divide-border">
            <div className={cn("hidden grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))] gap-3 pb-3 sm:grid", TYPE.meta)}>
              <span>{t("platforms.colPlatform")}</span>
              <span className="text-end">{t("platforms.colPosts")}</span>
              <span className="text-end">{t("platforms.colAvgViews")}</span>
              <span className="text-end">{t("platforms.colAvgEngagements")}</span>
              <span className="text-end">{t("platforms.colEngRate")}</span>
            </div>
            {data.channels.map((channel) => {
              const measured = Math.max(channel.measuredViews ?? 0, channel.measuredEngagements ?? 0);
              const cells: Array<[string, string]> = [
                [t("platforms.colPosts"), fmt.whole(channel.posts)],
                [t("platforms.colAvgViews"), fmt.metric(channel.avgViews ?? null)],
                [t("platforms.colAvgEngagements"), fmt.metric(channel.avgEngagements ?? null)],
                [t("platforms.colEngRate"), fmt.rate(channel.engagementRate ?? null)],
              ];
              return (
                <div key={channel.platform} className="py-4 sm:py-3">
                  <div className="grid grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))] items-center gap-3 max-sm:hidden">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Channel channel={channel.platform} size={20} />
                      <div className="min-w-0">
                        <p className={cn("m-0 truncate", TYPE.strong)}>{channelLabel(channel.platform)}</p>
                        <p className={cn("m-0", TYPE.hint)}>{t("platforms.measuredNote", { measured, posts: channel.posts })}</p>
                      </div>
                    </div>
                    {cells.map(([label, value]) => (
                      <span key={label} className={cn("text-end text-sm", TYPE.figure)}>{value}</span>
                    ))}
                  </div>
                  <div className="sm:hidden">
                    <div className="flex items-center gap-2.5">
                      <Channel channel={channel.platform} size={20} />
                      <p className={cn("m-0 min-w-0 flex-1 truncate", TYPE.strong)}>{channelLabel(channel.platform)}</p>
                      <p className={cn("m-0 shrink-0", TYPE.hint)}>{t("platforms.measuredNote", { measured, posts: channel.posts })}</p>
                    </div>
                    <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                      {cells.map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className={cn("truncate", TYPE.meta)}>{label}</dt>
                          <dd className={cn("m-0 mt-0.5 text-base", TYPE.figure)}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className={cn("mt-4", TYPE.hint)}>{t("platforms.includesImported")}</p>
      </Section>
    </div>
  );
}
