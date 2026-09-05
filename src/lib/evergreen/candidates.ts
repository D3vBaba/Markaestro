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
  mediaUrls: string[];
  engagements: number | null;
  views: number | null;
  /** Legacy field. A blended engagement rate is no longer computed. */
  engagementRate: number | null;
  eligible: boolean;
  reasons: string[];
  evidence: EvergreenEligibility['evidence'];
  assessment: EvergreenEligibility;
  /** Legacy field; no calibrated recommendation rule is available yet. */
  suggested: boolean;
};

const CANDIDATE_READ_LIMIT = 200;

/** Browse operationally reusable posts by recency. Metrics never imply endorsement. */
export function rankEvergreenCandidates(
  posts: Array<{ id: string } & Record<string, unknown>>,
  now = new Date(),
): EvergreenCandidate[] {
  const rows = posts.map((post) => {
    const eligibility = evaluateEvergreenEligibility(post, now);
    const metrics = eligibility.observations.length === 1 ? eligibility.observations[0].metrics : null;
    const views = metrics?.views ?? null;
    const engagements = null; // Do not sum unlike or partially measured actions.
    const media = Array.isArray(post.mediaUrls) ? (post.mediaUrls as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    return {
      id: post.id,
      content: typeof post.content === 'string' ? post.content : '',
      channel: typeof post.channel === 'string' ? post.channel : eligibility.channels[0] ?? '',
      channels: eligibility.channels,
      publishedAt: typeof post.publishedAt === 'string' ? post.publishedAt : null,
      thumbnailUrl: typeof post.thumbnailUrl === 'string' ? post.thumbnailUrl : media.find((url) => !isVideoMediaUrl(url)) ?? null,
      mediaUrl: media[0] ?? null,
      mediaUrls: media,
      engagements,
      views,
      engagementRate: null,
      eligible: eligibility.eligible,
      reasons: eligibility.reasons,
      evidence: eligibility.evidence,
      assessment: eligibility,
      suggested: false,
    };
  });

  rows.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.id.localeCompare(b.id);
  });
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
