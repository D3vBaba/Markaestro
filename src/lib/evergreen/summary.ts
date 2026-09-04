import { adminDb } from '@/lib/firebase-admin';
import { executeListQuery } from '@/lib/firestore-list-query';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';
import { evergreenMetricTotals, type EvergreenMetricTotals } from './analytics';

export type EvergreenEarnedSummary = {
  days: number;
  occurrences: number;
  freshPosts: number;
  evergreen: EvergreenMetricTotals & { trackedLinkClicks: number; attributedConversions: number };
  fresh: EvergreenMetricTotals;
  perPost: {
    evergreen: { views: number | null; engagements: number | null };
    fresh: { views: number | null; engagements: number | null };
  };
};

type PostLike = { id: string } & Record<string, unknown>;

function inWindow(post: PostLike, since: number): boolean {
  const at = typeof post.publishedAt === 'string' ? Date.parse(post.publishedAt) : Number.NaN;
  return Number.isFinite(at) && at >= since && post.status === 'published';
}

function sumTotals(posts: PostLike[]): EvergreenMetricTotals {
  const rows = posts.map((post) => evergreenMetricTotals(post.metricsByChannel));
  const sum = (field: keyof EvergreenMetricTotals) => {
    const values = rows.map((row) => row[field]).filter((v): v is number => v != null);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };
  return { views: sum('views'), reach: sum('reach'), engagements: sum('engagements'), platformClicks: sum('platformClicks') };
}

function perPost(totals: EvergreenMetricTotals, count: number) {
  return {
    views: totals.views != null && count > 0 ? Math.round(totals.views / count) : null,
    engagements: totals.engagements != null && count > 0 ? Math.round((totals.engagements / count) * 10) / 10 : null,
  };
}

/**
 * What the queues produced versus what fresh posts produced in the same
 * window, per post, so the comparison is fair whatever the volumes. Pure.
 */
export function summarizeEvergreenEarned(input: {
  occurrences: PostLike[];
  freshPosts: PostLike[];
  days: number;
  attribution?: Map<string, { clicks: number; conversions: number }>;
  now?: Date;
}): EvergreenEarnedSummary {
  const now = input.now ?? new Date();
  const since = now.getTime() - input.days * 24 * 60 * 60 * 1000;
  const occurrences = input.occurrences.filter((post) => inWindow(post, since));
  const fresh = input.freshPosts.filter((post) => inWindow(post, since) && post.sourceType !== 'evergreen');
  const evergreenTotals = sumTotals(occurrences);
  const freshTotals = sumTotals(fresh);
  let clicks = 0;
  let conversions = 0;
  for (const post of occurrences) {
    const linked = input.attribution?.get(post.id);
    clicks += linked?.clicks ?? 0;
    conversions += linked?.conversions ?? 0;
  }
  return {
    days: input.days,
    occurrences: occurrences.length,
    freshPosts: fresh.length,
    evergreen: { ...evergreenTotals, trackedLinkClicks: clicks, attributedConversions: conversions },
    fresh: freshTotals,
    perPost: { evergreen: perPost(evergreenTotals, occurrences.length), fresh: perPost(freshTotals, fresh.length) },
  };
}

export async function getEvergreenProductSummary(workspaceId: string, productId: string, days = 30): Promise<EvergreenEarnedSummary> {
  const queues = await adminDb.collection(`workspaces/${workspaceId}/evergreenQueues`)
    .where('productId', '==', productId)
    .limit(100)
    .get();
  const occurrenceIds: string[] = [];
  for (const queue of queues.docs) {
    const runs = await getAllMatchingDocs(queue.ref.collection('runs').orderBy('plannedAt', 'asc'));
    for (const run of runs) {
      const id = run.get('occurrencePostId');
      if (typeof id === 'string' && id) occurrenceIds.push(id);
    }
  }
  const occurrenceSnaps = occurrenceIds.length > 0
    ? await adminDb.getAll(...occurrenceIds.map((id) => adminDb.doc(`workspaces/${workspaceId}/posts/${id}`)))
    : [];
  const occurrences = occurrenceSnaps.filter((snap) => snap.exists).map((snap) => ({ id: snap.id, ...(snap.data() as Record<string, unknown>) }));

  const attribution = new Map<string, { clicks: number; conversions: number }>();
  for (let i = 0; i < occurrenceIds.length; i += 30) {
    const group = occurrenceIds.slice(i, i + 30);
    const links = await adminDb.collection(`workspaces/${workspaceId}/trackedLinks`).where('socialPostId', 'in', group).get();
    for (const doc of links.docs) {
      const id = doc.get('socialPostId');
      if (typeof id !== 'string') continue;
      const current = attribution.get(id) ?? { clicks: 0, conversions: 0 };
      current.clicks += Number(doc.get('clicks')) || 0;
      current.conversions += Number(doc.get('attributedConversions')) || 0;
      attribution.set(id, current);
    }
  }

  const freshPosts = await executeListQuery<Record<string, unknown>>(
    adminDb.collection(`workspaces/${workspaceId}/posts`),
    {
      filters: [
        { field: 'status', op: '==', value: 'published' },
        { field: 'productId', op: '==', value: productId },
      ],
      orderByField: 'createdAt',
      limit: 200,
    },
  );
  return summarizeEvergreenEarned({ occurrences, freshPosts, days, attribution });
}
