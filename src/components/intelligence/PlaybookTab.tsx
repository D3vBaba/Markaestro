"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChannelDot,
  DecisionButtons,
  DraftButton,
  EmptyState,
  KindBadge,
  LightbulbIcon,
  PhaseGate,
  Section,
  StatusFilterBar,
  TabHeader,
  phasesOf,
  type StatusFilter,
} from "./shared";
import { useIntelligenceCopy } from "./copy";
import { useIntelligenceFormat } from "./format";
import type { DecisionStatus, IntelligenceOverview, LearningRow, PostRow } from "./types";

function EvidencePosts({ ids, posts, metric }: { ids: string[]; posts: PostRow[]; metric: string }) {
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();
  const byId = new Map(posts.map((post) => [post.id, post]));
  const rows = ids.map((id) => byId.get(id)).filter((post): post is PostRow => Boolean(post)).slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("learnings.evidenceTitle")}</p>
      <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {rows.map((post) => (
          <div key={post.id} className="rounded-xl border border-slate-200/80 p-2.5 text-[11px] dark:border-slate-800/80">
            <div className="flex items-center justify-between gap-2">
              <ChannelDot platform={post.platform} />
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{fmt.metric(post.objectiveValue ?? post.views)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-slate-600 dark:text-slate-400">{post.content || t("content.mediaOnly")}</p>
            <p className="mt-1 text-[10px] text-slate-400">{fmt.metricName(metric)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LearningCard({ item, productId, posts }: { item: LearningRow; productId: string; posts: PostRow[] }) {
  const copy = useIntelligenceCopy();
  const [status, setStatus] = useState<DecisionStatus>(item.status || "proposed");
  const rendered = copy.learning(item);
  const platform = item.dimension === "platform" ? item.key : undefined;
  return (
    <Section trust="calculated" eyebrow={rendered.dimension} title={rendered.key}>
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge tone={item.strength === "potentially_strong" ? "emerald" : item.strength === "moderate" ? "blue" : "amber"}>
          <span title={rendered.strengthHint}>{rendered.strength}</span>
        </KindBadge>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">{rendered.strengthHint}</span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">{rendered.summary}</p>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50/80 px-3 py-2 dark:bg-slate-900/60">
          <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100">{rendered.comparison}</dd>
        </div>
        <div className="rounded-xl bg-slate-50/80 px-3 py-2 dark:bg-slate-900/60">
          <dd className="font-mono text-slate-700 dark:text-slate-300">{rendered.sample}</dd>
        </div>
        <div className="rounded-xl bg-slate-50/80 px-3 py-2 dark:bg-slate-900/60">
          <dd className="font-mono text-slate-700 dark:text-slate-300">{rendered.interval}</dd>
        </div>
      </dl>
      <EvidencePosts ids={item.evidencePostIds} posts={posts} metric={item.metric} />
      {status !== "dismissed" && (
        <div className="mt-4">
          <DraftButton productId={productId} source={{ type: "learning", id: item.id }} platform={platform} />
        </div>
      )}
      <DecisionButtons
        path={`/api/intelligence/learnings/${item.id}/decision`}
        productId={productId}
        status={item.status}
        kind="learning"
        onChanged={setStatus}
      />
    </Section>
  );
}

export function PlaybookTab({ data, productId }: { data: IntelligenceOverview; productId: string }) {
  const t = useTranslations("intelligence");
  const phases = phasesOf(data);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const posts = data.measuredPosts?.length ? data.measuredPosts : data.topContent;
  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = { all: 0, proposed: 0, accepted: 0, pinned: 0, dismissed: 0 };
    for (const item of data.learnings) {
      const status = (item.status || "proposed") as DecisionStatus;
      base[status] += 1;
      if (status !== "dismissed") base.all += 1;
    }
    return base;
  }, [data.learnings]);
  const visible = data.learnings.filter((item) => {
    const status = item.status || "proposed";
    return filter === "all" ? status !== "dismissed" : status === filter;
  });
  const patternCheck = data.readiness?.checks.find((check) => check.id === "contentPatterns");

  return (
    <div className="space-y-4 sm:space-y-5">
      <TabHeader topic="playbook" title={t("howItWorks.playbook.title")} body={t("howItWorks.playbook.intro")} />
      <PhaseGate enabled={phases.learning} feature="intelligenceOptimization">
        {patternCheck && !patternCheck.met && (
          <p className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            {t("learnings.contentPatternsNote", { required: patternCheck.required, current: data.readiness?.fingerprinted ?? patternCheck.current })}
          </p>
        )}
        {data.learnings.length === 0 ? (
          <EmptyState icon={LightbulbIcon} title={t("empty.playbookTitle")} body={t("empty.playbookBody")} />
        ) : (
          <>
            <StatusFilterBar value={filter} onChange={setFilter} counts={counts} />
            {visible.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("filter.none")}</p>
            ) : (
              visible.map((item) => <LearningCard key={item.id} item={item} productId={productId} posts={posts} />)
            )}
          </>
        )}
      </PhaseGate>
    </div>
  );
}
