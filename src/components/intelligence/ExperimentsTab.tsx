"use client";

import { useApiQuery } from "@/hooks/useApiQuery";
import ExperimentBoard, { type ExperimentItem } from "@/components/intelligence/ExperimentBoard";
import { PhaseGate, phasesOf } from "./shared";
import type { IntelligenceOverview } from "./types";

export function ExperimentsTab({
  data,
  productId,
  focusExperimentId,
}: {
  data: IntelligenceOverview;
  productId: string;
  focusExperimentId?: string | null;
}) {
  const phases = phasesOf(data);
  const experimentsQuery = useApiQuery<{ experiments: ExperimentItem[] }>(
    phases.experiments ? "/api/intelligence/experiments" : null,
  );
  const brandExperiments = (experimentsQuery.data?.experiments || []).filter((item) => item.productId === productId);

  return (
    <PhaseGate enabled={Boolean(phases.experiments)} feature="intelligenceExperiments">
      <ExperimentBoard
        productId={productId}
        experiments={brandExperiments}
        loading={experimentsQuery.loading && !experimentsQuery.data}
        focusExperimentId={focusExperimentId}
      />
    </PhaseGate>
  );
}
