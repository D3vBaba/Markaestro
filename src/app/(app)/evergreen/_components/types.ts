export type Evidence = { metric: "engagements" | "views"; value: number; explanation: string };

export type Queue = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  intervalDays: number;
  nextRunAt: string | null;
  reviewPolicy: "approve_future_runs" | "review_each_run";
  upcomingRunAts?: string[];
  lastCollisionShift?: { from: string; to: string; days: number; at: string } | null;
  channels: string[];
  activationEvidence: Evidence | null;
  runCount: number;
  pauseReason: string | null;
  sourcePostId: string;
};

export type Preview = {
  eligibility: { eligible: boolean; reasons: string[]; evidence: Evidence | null };
  recommendation: { intervalDays: number; timeZone: string; localHour: number; localMinute: number; scheduleMode: "fixed" | "learned"; explanation: string };
};

export type MetricTotals = { views: number | null; reach: number | null; engagements: number | null; platformClicks: number | null };

export type Analytics = {
  lifetime: MetricTotals & { trackedLinkClicks: number; attributedConversions: number; measuredOccurrences: number };
  runs: { total: number; published: number; evaluated: number; underperforming: number; failed: number; skipped: number; needsReview: number };
  recentRuns: Array<{ runId: string; occurrencePostId: string | null; plannedAt: string; status: string; performanceIndex: number | null; reason: string | null }>;
  variants: Array<{ variantId: string; caption: string; enabled: boolean; retiredReason: string | null; runs: number; evaluated: number; underperforming: number; averageIndex: number | null; metrics: MetricTotals }>;
};

export type EarnedSummary = {
  days: number;
  occurrences: number;
  freshPosts: number;
  evergreen: MetricTotals & { trackedLinkClicks: number; attributedConversions: number };
  fresh: MetricTotals;
  perPost: { evergreen: { views: number | null; engagements: number | null }; fresh: { views: number | null; engagements: number | null } };
};

export type ReviewRow = {
  queueId: string;
  queueName: string;
  runId: string;
  plannedAt: string;
  postId: string;
  content: string;
  channel: string;
  channels: string[];
  thumbnailUrl: string | null;
  mediaUrl: string | null;
};

export function messageFrom(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const value = data as { userMessage?: unknown; message?: unknown };
    if (typeof value.userMessage === "string") return value.userMessage;
    if (typeof value.message === "string") return value.message;
  }
  return fallback;
}
