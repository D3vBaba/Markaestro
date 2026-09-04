import { adminDb } from '@/lib/firebase-admin';
import { executeListQuery } from '@/lib/firestore-list-query';
import { evaluateEvergreenEligibility, type EvergreenEligibility } from './eligibility';
import { attachPostThumbnails, isVideoMediaUrl } from '@/lib/media/post-thumbnails';

export type EvergreenCandidate = {
  id: string;
  content: string;
  channel: string;
  channels: string[];
  publishedAt: string | null;
  thumbnailUrl: string | null;
  /** First media URL, so the UI can mark videos. */
  mediaUrl: string | null;
  engagements: number;
  views: number;
  /** engagements / views when both are measured, else null. */
  engagementRate: number | null;
  eligible: boolean;
  reasons: string[];
  evidence: EvergreenEligibility['evidence'];
  /** True for the strongest eligible posts, the ones worth turning evergreen first. */
  suggested: boolean;
};

const SUGGESTED_COUNT = 6;
const CANDIDATE_READ_LIMIT = 200;

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function signal(post: Record<string, unknown>): { engagements: number; views: number } {
  const perChannel = post.metricsByChannel && typeof post.metricsByChannel === 'object'
    ? Object.values(post.metricsByChannel as Record<string, unknown>)
    : [];
  const rows = perChannel.length > 0
    ? perChannel.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object')
    : [post.metrics && typeof post.metrics === 'object' ? (post.metrics as Record<string, unknown>) : post];
  const engagements = rows.reduce(
    (total, m) => total + ['likes', 'comments', 'shares', 'saves', 'clicks'].reduce((s, k) => s + num(m[k]), 0),
    0,
  );
  const views = rows.reduce((total, m) => total + (num(m.views) || num(m.impressions)), 0);
  return { engagements, views };
}

/**
 * Rank published posts as evergreen sources. Eligible posts come first, by a
 * blend of engagement, reach and a smoothed engagement rate. Ineligible posts
 * follow in the same order with the reasons they are not ready yet.
 * Pure: the Firestore read lives in listEvergreenCandidates.
 */
export function rankEvergreenCandidates(
  posts: Array<{ id: string } & Record<string, unknown>>,
  now = new Date(),
): EvergreenCandidate[] {
  const rows = posts.map((post) => {
    const eligibility = evaluateEvergreenEligibility(post, now);
    const { engagements, views } = signal(post);
    const media = Array.isArray(post.mediaUrls) ? (post.mediaUrls as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    return {
      id: post.id,
      content: typeof post.content === 'string' ? post.content : '',
      channel: typeof post.channel === 'string' ? post.channel : eligibility.channels[0] ?? '',
      channels: eligibility.channels,
      publishedAt: typeof post.publishedAt === 'string' ? post.publishedAt : null,
      thumbnailUrl: typeof post.thumbnailUrl === 'string' ? post.thumbnailUrl : media.find((url) => !isVideoMediaUrl(url)) ?? null,
      mediaUrl: media[0] ?? null,
      engagements,
      views,
      engagementRate: views > 0 ? engagements / views : null,
      eligible: eligibility.eligible,
      reasons: eligibility.reasons,
      evidence: eligibility.evidence,
      suggested: false,
    };
  });

  // Reach and engagement both count, and the rate is smoothed toward zero for
  // small audiences so two likes on two views does not outrank a post that
  // reached thousands.
  const score = (row: (typeof rows)[number]) =>
    row.engagements + row.views / 50 + (row.engagements / (row.views + 100)) * 500;

  rows.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  });

  let marked = 0;
  for (const row of rows) {
    if (row.eligible && marked < SUGGESTED_COUNT && (row.engagements > 0 || row.views > 0)) {
      row.suggested = true;
      marked += 1;
    }
  }
  return rows;
}

export async function listEvergreenCandidates(workspaceId: string, productId: string, now = new Date()) {
  const posts = await executeListQuery<Record<string, unknown>>(
    adminDb.collection(`workspaces/${workspaceId}/posts`),
    {
      filters: [
        { field: 'status', op: '==', value: 'published' },
        { field: 'productId', op: '==', value: productId },
      ],
      orderByField: 'createdAt',
      limit: CANDIDATE_READ_LIMIT,
    },
  );
  return rankEvergreenCandidates(await attachPostThumbnails(workspaceId, posts), now);
}
