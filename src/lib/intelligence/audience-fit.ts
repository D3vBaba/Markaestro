import type { SocialChannel } from '@/lib/schemas';

export const audienceFitComponents = [
  'audience', 'hook', 'opening', 'format', 'history', 'timing', 'cta',
  'conversation', 'professionalValue', 'searchEvergreen', 'visual',
] as const;

export type AudienceFitComponent = (typeof audienceFitComponents)[number];

export type AudienceFitAssessment = {
  component: AudienceFitComponent;
  score: number | null;
  confidence: number;
  evidence: string[];
  recommendation?: string;
};

type PlatformWeight = { component: AudienceFitComponent; weight: number; label: string };

export const AUDIENCE_FIT_WEIGHTS: Readonly<Record<SocialChannel, readonly PlatformWeight[]>> = {
  tiktok: [
    { component: 'audience', weight: 25, label: 'Audience relevance' },
    { component: 'hook', weight: 25, label: 'Hook' },
    { component: 'format', weight: 20, label: 'Format fit' },
    { component: 'history', weight: 15, label: 'Historical fit' },
    { component: 'timing', weight: 10, label: 'Timing' },
    { component: 'cta', weight: 5, label: 'CTA' },
  ],
  instagram: [
    { component: 'audience', weight: 25, label: 'Audience relevance' },
    { component: 'hook', weight: 15, label: 'Hook' },
    { component: 'format', weight: 20, label: 'Format fit' },
    { component: 'history', weight: 20, label: 'Historical fit' },
    { component: 'timing', weight: 10, label: 'Timing' },
    { component: 'cta', weight: 10, label: 'CTA' },
  ],
  facebook: [
    { component: 'audience', weight: 25, label: 'Audience relevance' },
    { component: 'opening', weight: 10, label: 'Opening' },
    { component: 'format', weight: 15, label: 'Format fit' },
    { component: 'history', weight: 20, label: 'Historical fit' },
    { component: 'timing', weight: 10, label: 'Timing' },
    { component: 'cta', weight: 20, label: 'CTA' },
  ],
  threads: [
    { component: 'audience', weight: 25, label: 'Audience relevance' },
    { component: 'opening', weight: 25, label: 'Opening' },
    { component: 'conversation', weight: 20, label: 'Conversation potential' },
    { component: 'history', weight: 15, label: 'Historical fit' },
    { component: 'timing', weight: 10, label: 'Timing' },
    { component: 'cta', weight: 5, label: 'CTA' },
  ],
  linkedin: [
    { component: 'audience', weight: 30, label: 'Audience and industry relevance' },
    { component: 'professionalValue', weight: 25, label: 'Professional value' },
    { component: 'format', weight: 10, label: 'Format fit' },
    { component: 'history', weight: 15, label: 'Historical fit' },
    { component: 'timing', weight: 10, label: 'Timing' },
    { component: 'cta', weight: 10, label: 'CTA' },
  ],
  pinterest: [
    { component: 'audience', weight: 15, label: 'Audience relevance' },
    { component: 'searchEvergreen', weight: 30, label: 'Search and evergreen fit' },
    { component: 'visual', weight: 25, label: 'Visual fit' },
    { component: 'history', weight: 10, label: 'Historical fit' },
    { component: 'timing', weight: 5, label: 'Timing' },
    { component: 'cta', weight: 15, label: 'Destination CTA' },
  ],
};

export type AudienceFitResult = {
  platform: SocialChannel;
  score: number | null;
  confidence: { score: number; label: 'low' | 'medium' | 'high' };
  dataCoverage: number;
  coldStart: boolean;
  sampleSize: number;
  components: Array<{
    component: AudienceFitComponent;
    label: string;
    weight: number;
    score: number | null;
    available: boolean;
    evidence: string[];
  }>;
  recommendations: string[];
  methodologyVersion: 1;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateAudienceFit(input: {
  platform: SocialChannel;
  assessments: AudienceFitAssessment[];
  historicalSampleSize: number;
  timingOverallSampleSize: number;
  timingSegmentSampleSize: number;
}): AudienceFitResult {
  const weights = AUDIENCE_FIT_WEIGHTS[input.platform];
  const byComponent = new Map(input.assessments.map((assessment) => [assessment.component, assessment]));
  const coldStart = input.historicalSampleSize < 5;

  const components = weights.map((weighted) => {
    const assessment = byComponent.get(weighted.component);
    const blockedBySample = weighted.component === 'history'
      ? input.historicalSampleSize < 5
      : weighted.component === 'timing'
        ? input.timingOverallSampleSize < 20 || input.timingSegmentSampleSize < 5
        : false;
    const score = !assessment || assessment.score === null || blockedBySample
      ? null
      : clamp(assessment.score, 0, 100);
    return {
      component: weighted.component,
      label: weighted.label,
      weight: weighted.weight,
      score,
      available: score !== null,
      evidence: score !== null ? assessment?.evidence ?? [] : [],
    };
  });

  const availableWeight = components.reduce((sum, component) => sum + (component.available ? component.weight : 0), 0);
  const weightedTotal = components.reduce(
    (sum, component) => sum + (component.score === null ? 0 : component.score * component.weight),
    0,
  );
  const score = availableWeight > 0 ? Math.round(weightedTotal / availableWeight) : null;
  const dataCoverage = Math.round(availableWeight);
  const availableAssessments = components
    .filter((component) => component.available)
    .map((component) => byComponent.get(component.component))
    .filter((assessment): assessment is AudienceFitAssessment => Boolean(assessment));
  const modelConfidence = availableAssessments.length > 0
    ? availableAssessments.reduce((sum, assessment) => sum + clamp(assessment.confidence, 0, 1), 0) / availableAssessments.length
    : 0;
  const sampleStrength = Math.min(1, input.historicalSampleSize / 30);
  const confidenceScore = Math.round(100 * (
    0.5 * (availableWeight / 100)
    + 0.25 * modelConfidence
    + 0.25 * sampleStrength
  ));
  const confidenceLabel = confidenceScore < 50 ? 'low' : confidenceScore < 75 ? 'medium' : 'high';

  const lowest = components
    .filter((component) => component.score !== null)
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))[0];
  const grounded = lowest
    ? byComponent.get(lowest.component)?.recommendation
      || `Lowest measurable component is ${lowest.label} at ${lowest.score}/100.${lowest.evidence[0] ? ` ${lowest.evidence[0]}` : ''}`
    : null;
  const recommendations = [
    ...(grounded ? [grounded] : []),
    ...components
      .filter((component) => component.component !== lowest?.component && component.score !== null)
      .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
      .map((component) => byComponent.get(component.component)?.recommendation)
      .filter((value): value is string => Boolean(value)),
  ].slice(0, 3);

  return {
    platform: input.platform,
    score,
    confidence: { score: confidenceScore, label: confidenceLabel },
    dataCoverage,
    coldStart,
    sampleSize: input.historicalSampleSize,
    components,
    recommendations,
    methodologyVersion: 1,
  };
}

