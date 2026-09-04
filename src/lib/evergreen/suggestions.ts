import { adminDb } from '@/lib/firebase-admin';
import { createInboxItem } from '@/lib/inbox';
import { listEvergreenCandidates, type EvergreenCandidate } from './candidates';

export const SUGGESTION_MIN_VIEWS = 200;
export const SUGGESTION_MIN_ENGAGEMENTS = 10;
const MAX_PER_BRAND = 2;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Which ranked candidates deserve a nudge: eligible, flagged suggested by the
 * ranking, with a real audience behind them, not already the source of a
 * queue, and never nudged before. At most two per brand per run so the inbox
 * stays a signal and not a feed.
 */
export function pickSuggestions(
  candidates: EvergreenCandidate[],
  existingSourceIds: Set<string>,
  alreadySuggested: Set<string>,
): EvergreenCandidate[] {
  return candidates
    .filter((row) => row.eligible && row.suggested)
    .filter((row) => row.views >= SUGGESTION_MIN_VIEWS || row.engagements >= SUGGESTION_MIN_ENGAGEMENTS)
    .filter((row) => !existingSourceIds.has(row.id) && !alreadySuggested.has(row.id))
    .slice(0, MAX_PER_BRAND);
}

export async function suggestEvergreenCandidates(workspaceId: string, now = new Date()): Promise<{ suggested: number; skipped: boolean }> {
  const stateRef = adminDb.doc(`workspaces/${workspaceId}/evergreenState/suggestions`);
  const state = await stateRef.get();
  const lastRunAt = state.exists ? Date.parse(String(state.data()?.lastRunAt ?? '')) : Number.NaN;
  if (Number.isFinite(lastRunAt) && now.getTime() - lastRunAt < RUN_INTERVAL_MS) return { suggested: 0, skipped: true };
  await stateRef.set({ lastRunAt: now.toISOString() }, { merge: true });

  const [products, queues] = await Promise.all([
    adminDb.collection(`workspaces/${workspaceId}/products`).limit(100).get(),
    adminDb.collection(`workspaces/${workspaceId}/evergreenQueues`).limit(500).get(),
  ]);
  const existingSourceIds = new Set(queues.docs
    .filter((doc) => doc.data().status !== 'archived')
    .map((doc) => String(doc.data().sourcePostId ?? '')));

  let suggested = 0;
  for (const product of products.docs) {
    const candidates = await listEvergreenCandidates(workspaceId, product.id, now);
    const alreadySuggested = new Set<string>();
    const postSnaps = candidates.length > 0
      ? await adminDb.getAll(...candidates.slice(0, 20).map((row) => adminDb.doc(`workspaces/${workspaceId}/posts/${row.id}`)))
      : [];
    const authors = new Map<string, string>();
    for (const snap of postSnaps) {
      if (!snap.exists) continue;
      if (snap.data()?.evergreenSuggestedAt) alreadySuggested.add(snap.id);
      if (typeof snap.data()?.createdBy === 'string') authors.set(snap.id, snap.data()!.createdBy);
    }
    for (const row of pickSuggestions(candidates, existingSourceIds, alreadySuggested)) {
      const uid = authors.get(row.id);
      if (!uid) continue;
      const brandName = String(product.data().name || 'this brand');
      await createInboxItem({
        id: `evergreen_suggest_${row.id}`,
        workspaceId,
        uid,
        type: 'system',
        title: `A keeper for ${brandName}`,
        body: row.views > 0
          ? `Your post reached ${row.views.toLocaleString()} views and ${row.engagements.toLocaleString()} engagements. Repeat it every 30 days with Evergreen.`
          : `Your post earned ${row.engagements.toLocaleString()} engagements. Repeat it every 30 days with Evergreen.`,
        href: `/evergreen?brand=${encodeURIComponent(product.id)}&source=${encodeURIComponent(row.id)}`,
        meta: { productId: product.id, sourcePostId: row.id, kind: 'evergreen_suggestion' },
      });
      await adminDb.doc(`workspaces/${workspaceId}/posts/${row.id}`).set({ evergreenSuggestedAt: now.toISOString() }, { merge: true });
      suggested += 1;
    }
  }
  return { suggested, skipped: false };
}
