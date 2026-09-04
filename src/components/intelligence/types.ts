import type { OverviewChannelRow, OverviewPostRow } from "@/lib/intelligence/overview-metrics";
import type { OptimizationOpportunity } from "@/lib/intelligence/opportunities";
import type { BrandLearning } from "@/lib/intelligence/learnings";
import type { TimingRecommendation } from "@/lib/intelligence/timing";
import type { IntelligenceReadiness } from "@/lib/intelligence/readiness";
import type { ObjectiveSummary } from "@/lib/intelligence/insights";
import type { IntelligenceTrustKind } from "@/lib/intelligence/schemas";
import type { CohortRow, DecisionOutcome, PillarCoverage, SuggestedExperiment, WeeklyPulse } from "@/lib/intelligence/pulse";

export type ExperimentResultRow = {
  id: string;
  name: string;
  hypothesis: string | null;
  platform: string | null;
  metric: string;
  status: string;
  effectPercent: number | null;
  reason: string | null;
  evaluatedAt: string | null;
};

/** Seeds the experiment composer from a move, a pattern, or an idea. */
export type ExperimentDraft = {
  id: string;
  name: string;
  hypothesis: string;
  platform?: string | null;
};

export type TrustKind = IntelligenceTrustKind | "declared" | "generated";

export type PostRow = OverviewPostRow & { objectiveValue: number | null };
export type ChannelRow = OverviewChannelRow;
export type OpportunityRow = OptimizationOpportunity;
export type LearningRow = BrandLearning;

export type IntelligencePhases = {
  foundation: boolean;
  learning: boolean;
  growth: boolean;
  advanced: boolean;
  experiments?: boolean;
  strategist?: boolean;
};

export type IntelligenceQuota = {
  tier: string;
  aiOperationsUsed: number;
  aiOperationsLimit: number;
  strategistTurnsUsed: number;
  strategistTurnsLimit: number;
};

export type IntelligenceOverview = {
  products: Array<{ id: string; name: string }>;
  productId: string | null;
  profile: {
    objective?: string;
    primaryTimezone?: string;
    targetMarkets?: Array<{ code: string; label?: string; weight: number }>;
    contentPillars?: string[];
  } | null;
  phases?: IntelligencePhases;
  quota?: IntelligenceQuota;
  totals: null | {
    posts: number;
    views: number | null;
    reach: number | null;
    clicks: number | null;
    conversions: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    coverage: Record<string, number>;
  };
  channels: ChannelRow[];
  topContent: PostRow[];
  measuredPosts?: PostRow[];
  alignment?: { score: number | null; coverage: number; dimensions: Record<string, number | null> } | null;
  timing?: TimingRecommendation | null;
  drift?: { title: string; summary: string } | null;
  learnings: LearningRow[];
  opportunities: OpportunityRow[];
  readiness?: IntelligenceReadiness | null;
  objective?: ObjectiveSummary | null;
  pulse?: WeeklyPulse | null;
  cohorts?: { rows: CohortRow[]; stopDoing: CohortRow[] } | null;
  pillars?: PillarCoverage[];
  outcomes?: Record<string, DecisionOutcome>;
  suggestedExperiments?: SuggestedExperiment[];
  experimentResults?: ExperimentResultRow[];
  computedAt?: string;
  cached?: boolean;
};

export type DecisionStatus = "proposed" | "accepted" | "pinned" | "dismissed";

export type TrackedLink = {
  code: string;
  label: string;
  destination: string;
  url: string;
  /** False once retired. The redirect answers 410 for a retired code. */
  active: boolean;
  deletedAt: string | null;
  clicks: number;
  lastClickedAt: string | null;
  attributedConversions: number;
  createdAt: string | null;
};

export type PostExplanation = {
  summary: string;
  factors: Array<{ label: string; detail: string }>;
  tryNext: string | null;
  createdAt: string;
};

export type DraftResult = {
  postId: string;
  platform: string;
  content: string;
  rationale: string;
  evidenceIds: string[];
};
