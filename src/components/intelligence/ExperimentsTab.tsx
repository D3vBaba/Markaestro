"use client";

import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";
import { useApiQuery } from "@/hooks/useApiQuery";
import ExperimentBoard, { type ExperimentItem } from "@/components/intelligence/ExperimentBoard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { channelLabel } from "@/components/mk/channels";
import type { SuggestedExperiment } from "@/lib/intelligence/pulse";
import { INSET, KindBadge, PhaseGate, Section, TYPE, phasesOf } from "./shared";
import type { ExperimentDraft, IntelligenceOverview } from "./types";

function ideaArms(idea: SuggestedExperiment): { a: string; b: string } {
  if (idea.kind === "platform") return { a: channelLabel(idea.armA), b: channelLabel(idea.armB) };
  return { a: idea.armA, b: idea.armB };
}

function TestIdeas({ ideas, onPick }: { ideas: SuggestedExperiment[]; onPick: (draft: ExperimentDraft) => void }) {
  const t = useTranslations("intelligence.testIdeas");
  const title = (idea: SuggestedExperiment) => {
    const arms = ideaArms(idea);
    if (idea.kind === "timing") return t("titles.timing", arms);
    if (idea.kind === "platform") return t("titles.platform", arms);
    if (idea.kind === "hook") return t("titles.hook");
    return t("titles.pillar", { a: arms.a });
  };
  return (
    <Section trust="recommended" title={t("title")} subtitle={t("subtitle")}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {ideas.map((idea) => (
          <div key={idea.id} className={cn("flex min-w-0 flex-col gap-2 p-4", INSET)}>
            <div><KindBadge tone="blue">{t(`kinds.${idea.kind}`)}</KindBadge></div>
            <p className={cn("m-0 text-pretty", TYPE.cardTitle)}>{title(idea)}</p>
            <p className={cn("m-0", TYPE.hint)}>{t("arms", ideaArms(idea))}</p>
            <div className="mt-auto pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onPick({ id: `idea:${idea.id}`, name: idea.title, hypothesis: idea.hypothesis, platform: idea.platform })}
              >
                <FlaskConical className="size-3.5" aria-hidden="true" />
                {t("setUp")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function ExperimentsTab({
  data,
  productId,
  focusExperimentId,
  draft,
  onDraft,
}: {
  data: IntelligenceOverview;
  productId: string;
  focusExperimentId?: string | null;
  draft?: ExperimentDraft | null;
  onDraft?: (draft: ExperimentDraft) => void;
}) {
  const phases = phasesOf(data);
  const experimentsQuery = useApiQuery<{ experiments: ExperimentItem[] }>(
    phases.experiments ? "/api/intelligence/experiments" : null,
  );
  const brandExperiments = (experimentsQuery.data?.experiments || []).filter((item) => item.productId === productId);
  const ideas = data.suggestedExperiments ?? [];

  return (
    <PhaseGate enabled={Boolean(phases.experiments)} feature="intelligenceExperiments">
      <div className="space-y-4 sm:space-y-5">
        {ideas.length > 0 && onDraft && <TestIdeas ideas={ideas} onPick={onDraft} />}
        <ExperimentBoard
          key={draft?.id ?? "blank"}
          productId={productId}
          experiments={brandExperiments}
          loading={experimentsQuery.loading && !experimentsQuery.data}
          focusExperimentId={focusExperimentId}
          initialDraft={draft}
        />
      </div>
    </PhaseGate>
  );
}
