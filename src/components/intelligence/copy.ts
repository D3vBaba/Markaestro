"use client";

import { useTranslations } from "next-intl";
import { channelLabel } from "@/components/mk/channels";
import { useIntelligenceFormat } from "./format";
import type { LearningRow, OpportunityRow } from "./types";

/**
 * Renders the structured server payload (kind + params) as localized copy.
 * The English `title` / `recommendation` strings stored in Firestore are only
 * a fallback for records written before params existed.
 */
export function useIntelligenceCopy() {
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();

  function dimensionLabel(dimension: LearningRow["dimension"]): string {
    return t(`learnings.dimensions.${dimension}`);
  }

  function learningKeyLabel(learning: Pick<LearningRow, "dimension" | "key">): string {
    if (learning.dimension === "platform") return channelLabel(learning.key);
    if (learning.dimension === "hook") {
      return learning.key === "has_hook" || learning.key === "no_hook" ? t(`learnings.keys.${learning.key}`) : learning.key;
    }
    if (learning.dimension === "timing") {
      const [weekday, hour] = learning.key.split("-");
      return weekday && hour ? fmt.window(weekday, hour) : learning.key;
    }
    return learning.key.replaceAll("_", " ");
  }

  function opportunity(item: OpportunityRow): { kind: string; title: string; body: string; evidence: string } {
    const params = item.params;
    if (!params) {
      return { kind: t(`opportunities.kinds.${item.kind}`), title: item.title, body: item.recommendation, evidence: "" };
    }
    if (params.kind === "timing") {
      const lift = params.liftPercent === null
        ? ""
        : params.liftPercent >= 0
          ? t("timing.liftUp", { value: Math.round(params.liftPercent) })
          : t("timing.liftDown", { value: Math.round(params.liftPercent) });
      return {
        kind: t("opportunities.kinds.timing"),
        title: t("opportunities.timing.title", { weekday: fmt.weekday(params.weekday), hour: fmt.hour(params.hour) }),
        body: t("opportunities.timing.body", {
          estimate: fmt.metric(params.estimate),
          metric: fmt.metricName(params.metric),
          lift,
        }),
        evidence: t("opportunities.timing.evidence", { count: params.observations, timeZone: params.timeZone }),
      };
    }
    if (params.kind === "platform") {
      const leader = channelLabel(params.leader);
      const trailing = channelLabel(params.trailing);
      const metric = t(`metrics.${params.metric}`).toLowerCase();
      // Whole numbers once the average is in double digits; decimals only matter below that.
      const perPost = (value: number) => (value >= 10 ? fmt.whole(Math.round(value)) : value.toFixed(1));
      return {
        kind: t("opportunities.kinds.platform"),
        title: t("opportunities.platform.title", { leader, trailing }),
        body: t("opportunities.platform.body", {
          leader,
          trailing,
          metric,
          leaderPerPost: perPost(params.leaderPerPost),
          trailingPerPost: perPost(params.trailingPerPost),
        }),
        evidence: t("opportunities.platform.evidence", {
          leader,
          trailing,
          leaderPosts: params.leaderPosts,
          trailingPosts: params.trailingPosts,
        }),
      };
    }
    if (params.kind === "learning") {
      const pattern = `${dimensionLabel(params.dimension)}: ${learningKeyLabel({ dimension: params.dimension, key: params.key })}`;
      return {
        kind: t("opportunities.kinds.learning"),
        title: t("opportunities.learning.title", { pattern }),
        body: t("opportunities.learning.body", {
          effect: Math.round(params.effectPercent ?? 0),
          metric: fmt.metricName(params.metric),
        }),
        evidence: t("opportunities.learning.evidence", { count: params.observations }),
      };
    }
    const dimension = t(`alignment.dimensions.${params.dimension as "geography"}`);
    return {
      kind: t("opportunities.kinds.alignment"),
      title: t("opportunities.alignment.title", { dimension }),
      body: t("opportunities.alignment.body", { dimension, score: params.score }),
      evidence: t("opportunities.alignment.evidence"),
    };
  }

  function learning(item: LearningRow): {
    dimension: string;
    key: string;
    title: string;
    summary: string;
    comparison: string;
    sample: string;
    interval: string;
    strength: string;
    strengthHint: string;
  } {
    const metric = fmt.metricName(item.metric);
    const effect = Math.abs(Math.round(item.effectPercent ?? 0));
    const up = (item.effectPercent ?? 0) >= 0;
    const strength = item.strength === "insufficient" ? "directional" : item.strength;
    return {
      dimension: dimensionLabel(item.dimension),
      key: learningKeyLabel(item),
      title: `${dimensionLabel(item.dimension)}: ${learningKeyLabel(item)}`,
      summary: t(up ? "learnings.summaryUp" : "learnings.summaryDown", { count: item.observations, effect, metric }),
      comparison: t("learnings.groupVsRest", {
        group: fmt.metric(item.groupMean),
        rest: fmt.metric(item.restMean),
        metric,
      }),
      sample: t("learnings.sample", { group: item.observations, rest: item.controlObservations ?? 0 }),
      interval: item.confidenceInterval
        ? t("learnings.ci", { low: Math.round(item.confidenceInterval[0]), high: Math.round(item.confidenceInterval[1]) })
        : t("learnings.ciMissing"),
      strength: t(`learnings.strength.${strength}`),
      strengthHint: t(`learnings.strengthHints.${strength}`),
    };
  }

  return { opportunity, learning, dimensionLabel, learningKeyLabel };
}
