import { adminDb } from '@/lib/firebase-admin';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { EvergreenRun } from './types';

export type EvergreenMetricTotals = {
  views: number | null;
  reach: number | null;
  engagements: number | null;
  platformClicks: number | null;
};

export type EvergreenRunAnalytics = {
  runId: string;
  occurrencePostId: string | null;
  plannedAt: string;
  status: EvergreenRun['status'];
  performanceIndex: number | null;
  reason: string | null;
  metrics: EvergreenMetricTotals;
  trackedLinkClicks: number;
  attributedConversions: number;
};

export type EvergreenQueueAnalytics = {
  queueId: string;
  source: EvergreenMetricTotals;
  lifetime: EvergreenMetricTotals & {
    trackedLinkClicks: number;
    attributedConversions: number;
    measuredOccurrences: number;
  };
  runs: {
    total: number;
    published: number;
    evaluated: number;
    underperforming: number;
    failed: number;
    skipped: number;
    needsReview: number;
  };
  recentRuns: EvergreenRunAnalytics[];
};

const ENGAGEMENT_FIELDS = ['likes', 'comments', 'shares', 'saves'] as const;

function metricsRows(value: unknown): NormalizedPostMetrics[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>)
    .filter((row): row is NormalizedPostMetrics => Boolean(row) && typeof row === 'object');
}

function sumMeasured(rows: NormalizedPostMetrics[], fields: ReadonlyArray<keyof NormalizedPostMetrics>): number | null {
  let total = 0;
  let measured = false;
  for (const row of rows) {
    for (const field of fields) {
      const value = row[field];
      if (typeof value === 'number' && Number.isFinite(value)) {
        total += value;
        measured = true;
      }
    }
  }
  return measured ? total : null;
}

export function evergreenMetricTotals(metricsByChannel: unknown): EvergreenMetricTotals {
  const rows = metricsRows(metricsByChannel);
  return {
    views: sumMeasured(rows, ['views']),
    reach: sumMeasured(rows, ['reach']),
    engagements: sumMeasured(rows, ENGAGEMENT_FIELDS),
    platformClicks: sumMeasured(rows, ['clicks']),
  };
}

export function combineEvergreenMetricTotals(rows: EvergreenMetricTotals[]): EvergreenMetricTotals {
  const sum = (field: keyof EvergreenMetricTotals): number | null => {
    const values = rows.map((row) => row[field]).filter((value): value is number => value != null);
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    views: sum('views'),
    reach: sum('reach'),
    engagements: sum('engagements'),
    platformClicks: sum('platformClicks'),
  };
}

function chunks<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

export async function getEvergreenQueueAnalytics(
  workspaceId: string,
  queueId: string,
): Promise<EvergreenQueueAnalytics> {
  const queueRef = adminDb.doc(`workspaces/${workspaceId}/evergreenQueues/${queueId}`);
  const queueSnap = await queueRef.get();
  if (!queueSnap.exists) throw new Error('NOT_FOUND');
  const queue = queueSnap.data() as Record<string, unknown>;

  const runDocs = await getAllMatchingDocs(queueRef.collection('runs').orderBy('plannedAt', 'asc'));
  const runs = runDocs.map((doc) => ({ id: doc.id, ...doc.data() }) as EvergreenRun);
  const occurrenceIds = [...new Set(runs
    .map((run) => run.occurrencePostId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const sourcePostId = typeof queue.sourcePostId === 'string' ? queue.sourcePostId : '';

  const postIds = [...new Set([sourcePostId, ...occurrenceIds].filter(Boolean))];
  const postSnaps = postIds.length > 0
    ? await adminDb.getAll(...postIds.map((id) => adminDb.doc(`workspaces/${workspaceId}/posts/${id}`)))
    : [];
  const posts = new Map(postSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data() as Record<string, unknown>]));

  // Links normally reference canonical social-post ids, while API consumers
  // may bind one directly to a Markaestro post id. Resolve both forms.
  const canonicalToOccurrence = new Map<string, string>();
  for (const group of chunks(occurrenceIds, 30)) {
    const snap = await adminDb.collection(`workspaces/${workspaceId}/socialPosts`)
      .where('markaestroPostId', 'in', group)
      .get();
    for (const doc of snap.docs) {
      const occurrenceId = doc.get('markaestroPostId');
      if (typeof occurrenceId === 'string') canonicalToOccurrence.set(doc.id, occurrenceId);
    }
  }

  const linkIds = [...new Set([...occurrenceIds, ...canonicalToOccurrence.keys()])];
  const attribution = new Map<string, { clicks: number; conversions: number }>();
  for (const group of chunks(linkIds, 30)) {
    const snap = await adminDb.collection(`workspaces/${workspaceId}/trackedLinks`)
      .where('socialPostId', 'in', group)
      .get();
    for (const doc of snap.docs) {
      const linkedId = doc.get('socialPostId');
      if (typeof linkedId !== 'string') continue;
      const occurrenceId = canonicalToOccurrence.get(linkedId) ?? linkedId;
      const current = attribution.get(occurrenceId) ?? { clicks: 0, conversions: 0 };
      current.clicks += Number(doc.get('clicks')) || 0;
      current.conversions += Number(doc.get('attributedConversions')) || 0;
      attribution.set(occurrenceId, current);
    }
  }

  const runAnalytics: EvergreenRunAnalytics[] = runs.map((run) => {
    const occurrenceId = run.occurrencePostId;
    const linked = occurrenceId ? attribution.get(occurrenceId) : undefined;
    return {
      runId: run.id,
      occurrencePostId: occurrenceId,
      plannedAt: run.plannedAt,
      status: run.status,
      performanceIndex: run.performanceIndex ?? null,
      reason: run.reason ?? null,
      metrics: evergreenMetricTotals(occurrenceId ? posts.get(occurrenceId)?.metricsByChannel : null),
      trackedLinkClicks: linked?.clicks ?? 0,
      attributedConversions: linked?.conversions ?? 0,
    };
  });
  const lifetime = combineEvergreenMetricTotals(runAnalytics.map((run) => run.metrics));

  return {
    queueId,
    source: evergreenMetricTotals(posts.get(sourcePostId)?.metricsByChannel),
    lifetime: {
      ...lifetime,
      trackedLinkClicks: runAnalytics.reduce((total, run) => total + run.trackedLinkClicks, 0),
      attributedConversions: runAnalytics.reduce((total, run) => total + run.attributedConversions, 0),
      measuredOccurrences: runAnalytics.filter((run) => Object.values(run.metrics).some((value) => value != null)).length,
    },
    runs: {
      total: runs.length,
      published: runs.filter((run) => ['published', 'evaluated'].includes(run.status)).length,
      evaluated: runs.filter((run) => run.status === 'evaluated').length,
      underperforming: runs.filter((run) => run.reason === 'UNDERPERFORMED').length,
      failed: runs.filter((run) => run.status === 'failed').length,
      skipped: runs.filter((run) => run.status === 'skipped').length,
      needsReview: runs.filter((run) => run.status === 'needs_review').length,
    },
    recentRuns: runAnalytics.slice(-10).reverse(),
  };
}
