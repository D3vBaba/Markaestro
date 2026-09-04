import { adminDb } from '@/lib/firebase-admin';
import { executeListQuery } from '@/lib/firestore-list-query';
import { normalizeCaption } from './variants';

export const DUPLICATE_WINDOW_DAYS = 60;

export type DuplicateMatch = {
  caption: string;
  postId: string;
  channel: string;
  publishedAt: string | null;
};

/**
 * Platforms penalise identical text (X rejects it outright). Flag any caption
 * that matches, after normalisation, something the brand published in the
 * last 60 days.
 */
export function findDuplicateCaptions(
  captions: string[],
  published: Array<{ id: string; content?: unknown; channel?: unknown; publishedAt?: unknown }>,
  now = new Date(),
): DuplicateMatch[] {
  const cutoff = now.getTime() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = published.filter((post) => {
    const at = typeof post.publishedAt === 'string' ? Date.parse(post.publishedAt) : Number.NaN;
    return Number.isFinite(at) && at >= cutoff && typeof post.content === 'string' && post.content.trim().length > 0;
  });
  const byKey = new Map<string, (typeof recent)[number]>();
  for (const post of recent) byKey.set(normalizeCaption(String(post.content)), post);
  const matches: DuplicateMatch[] = [];
  for (const caption of captions) {
    const key = normalizeCaption(caption);
    if (!key) continue;
    const hit = byKey.get(key);
    if (hit) {
      matches.push({
        caption,
        postId: hit.id,
        channel: typeof hit.channel === 'string' ? hit.channel : '',
        publishedAt: typeof hit.publishedAt === 'string' ? hit.publishedAt : null,
      });
    }
  }
  return matches;
}

export async function checkCaptionDuplicates(workspaceId: string, productId: string, captions: string[]) {
  const posts = await executeListQuery<Record<string, unknown>>(
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
  return findDuplicateCaptions(captions, posts);
}
