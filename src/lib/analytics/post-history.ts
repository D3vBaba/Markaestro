/**
 * One post's metric history, whichever collection holds it.
 *
 * A Markaestro post lives in `posts` with its stage snapshots beneath it; a
 * post published directly on the platform lives in `socialPosts` (provenance
 * `platform_native`) with the snapshots the native poller wrote. Both history
 * routes (the in-app one and the public one) resolve an id through here, so
 * an agent can hand back any id it saw in a leaderboard or list and get the
 * same answer a person gets. The routes keep their own visibility rules;
 * this only finds the post and builds its stages.
 */
import { adminDb } from '@/lib/firebase-admin';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import type { AnalyticsPostSource } from './api-shape';
import { buildPostHistory, type PostHistoryStage } from './history';
import { isNativePostDoc, nativePostToAnalyticsPost, type NativeSocialPostDoc } from './native-posts';
import type { AnalyticsPostDoc } from './query';
import type { MetricSnapshotDoc } from './types';

/** Both Firestore auto ids and canonical social post ids fit; anything else is not an id. */
export const POST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Stage snapshots read per post; the schedule writes nine, plus retries and refreshes. */
const MAX_SNAPSHOTS = 50;

type MarkaestroHistoryDoc = AnalyticsPostDoc & {
  status?: string;
  metricsStatus?: string;
  metricsNextPollAt?: string;
};

export type PostHistoryRecord = {
  id: string;
  source: AnalyticsPostSource;
  productId: string | null;
  /** `published` for every native post; a Markaestro post's own status. */
  status: string | null;
  testMode: boolean;
  /** The row-shaped document `postToRow` reads. */
  post: AnalyticsPostDoc;
  channels: string[];
  metricsStatus: string | null;
  nextPollAt: string | null;
  stages: PostHistoryStage[];
};

async function readWithSnapshots(path: string): Promise<{
  data: FirebaseFirestore.DocumentData | undefined;
  snapshots: Array<Pick<MetricSnapshotDoc, 'stageKey' | 'capturedAt' | 'byChannel'>>;
}> {
  const ref = adminDb.doc(path);
  const [snap, snapshots] = await Promise.all([
    ref.get(),
    ref.collection('metrics').orderBy('capturedAt', 'asc').limit(MAX_SNAPSHOTS).get(),
  ]);
  return {
    data: snap.exists ? snap.data() : undefined,
    snapshots: snapshots.docs.map((doc) => doc.data() as MetricSnapshotDoc),
  };
}

function latestOf(post: { metricsUpdatedAt?: string; metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>> }) {
  return post.metricsUpdatedAt && post.metricsByChannel
    ? { capturedAt: post.metricsUpdatedAt, byChannel: post.metricsByChannel }
    : null;
}

/**
 * The post behind an id, with its stages oldest first, or null when neither
 * collection has it. Markaestro posts are tried first: their ids are the
 * ones people and agents see most, and the two id spaces do not overlap in
 * practice (Firestore auto ids against 40-character content hashes).
 */
export async function loadPostHistoryRecord(workspaceId: string, id: string): Promise<PostHistoryRecord | null> {
  if (!POST_ID_PATTERN.test(id)) return null;

  const markaestro = await readWithSnapshots(`workspaces/${workspaceId}/posts/${id}`);
  if (markaestro.data) {
    const post = markaestro.data as MarkaestroHistoryDoc;
    return {
      id,
      source: 'markaestro',
      productId: post.productId ?? null,
      status: post.status ?? null,
      testMode: post.testMode === true,
      post,
      channels: (post.publishedChannels?.length ? post.publishedChannels : [post.channel])
        .filter((c): c is string => Boolean(c)),
      metricsStatus: post.metricsStatus ?? null,
      nextPollAt: post.metricsNextPollAt ?? null,
      stages: buildPostHistory({
        publishedAt: post.publishedAt ?? null,
        snapshots: markaestro.snapshots,
        latest: latestOf(post),
      }),
    };
  }

  const native = await readWithSnapshots(`workspaces/${workspaceId}/socialPosts/${id}`);
  const doc = native.data as NativeSocialPostDoc | undefined;
  if (!doc || !isNativePostDoc(doc)) return null;
  const post = nativePostToAnalyticsPost({ ...doc, platform: doc.platform as SocialChannel });
  return {
    id,
    source: 'native',
    productId: post.productId ?? null,
    status: 'published',
    testMode: false,
    post,
    channels: post.publishedChannels,
    metricsStatus: doc.metricsStatus ?? null,
    nextPollAt: doc.metricsNextPollAt ?? null,
    stages: buildPostHistory({
      publishedAt: post.publishedAt ?? null,
      snapshots: native.snapshots,
      latest: latestOf(doc),
    }),
  };
}
