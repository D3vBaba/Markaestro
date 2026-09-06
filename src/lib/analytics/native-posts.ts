/**
 * Platform-native posts in analytics.
 *
 * Posts published directly on a platform (not through Markaestro) are
 * discovered from the connected account by the native importer and stored as
 * canonical social posts (`workspaces/{ws}/socialPosts/{id}`, provenance
 * `platform_native`). Analytics reads them alongside the workspace's own
 * `posts`, so a brand that posts natively half the time still sees the whole
 * account. This module is the shared vocabulary for that: the query the
 * readers use, the mapping into the analytics post shape, the poll state the
 * native metrics poller drives, and the rule that keeps a post that exists in
 * both collections from counting twice.
 *
 * Nothing here talks to a platform; discovery is `@/lib/intelligence/native-import`
 * and metrics are `./native-metrics-poller`.
 */
import { adminDb } from '@/lib/firebase-admin';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import type { PostContentType } from './api-shape';
import { METRIC_POLL_STAGES, type PostMetricsState } from './types';

export const NATIVE_POST_PROVENANCE = 'platform_native';

/** The fields of a native canonical social post the analytics readers use. */
export type NativeSocialPostDoc = PostMetricsState & {
  provenance?: string;
  productId?: string | null;
  platform?: SocialChannel | string;
  provider?: string;
  accountKey?: string;
  externalId?: string;
  content?: string | null;
  contentType?: 'text' | 'image' | 'video' | 'carousel' | 'unknown';
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  permalink?: string | null;
  publishedAt?: string | null;
  discoveredAt?: string;
  /** Set once the post was taken down on the platform; the record stays for history. */
  deletedAt?: string | null;
  /** The single-platform latest metrics the Intelligence readers use. */
  latestMetrics?: NormalizedPostMetrics;
};

/** The fields a native post needs to become an analytics row; used with `select`. */
export const NATIVE_POST_ANALYTICS_FIELDS = [
  'provenance', 'productId', 'platform', 'externalId', 'content', 'contentType', 'mediaUrl',
  'permalink', 'publishedAt', 'metricsByChannel', 'metricsUpdatedAt',
] as const;

/**
 * The native posts of a workspace (optionally one brand) published on or
 * after `sinceIso`, newest first. Every reader goes through here so the
 * provenance filter and the index it needs live in one place.
 */
export function nativePostsQuery(
  workspaceId: string,
  opts: { productId?: string; sinceIso: string; untilIsoExclusive?: string },
): FirebaseFirestore.Query {
  let query: FirebaseFirestore.Query = adminDb
    .collection(`workspaces/${workspaceId}/socialPosts`)
    .where('provenance', '==', NATIVE_POST_PROVENANCE);
  if (opts.productId) query = query.where('productId', '==', opts.productId);
  query = query.where('publishedAt', '>=', opts.sinceIso);
  if (opts.untilIsoExclusive) query = query.where('publishedAt', '<', opts.untilIsoExclusive);
  return query;
}

/** True for a document the analytics readers may treat as a native post. */
export function isNativePostDoc(doc: NativeSocialPostDoc): doc is NativeSocialPostDoc & { platform: SocialChannel; externalId: string } {
  return doc.provenance === NATIVE_POST_PROVENANCE
    && typeof doc.platform === 'string' && doc.platform.length > 0
    && typeof doc.externalId === 'string' && doc.externalId.length > 0;
}

/** The dedupe key shared by both collections: a platform post is one (channel, id) pair. */
export function platformPostKey(channel: string, externalId: string): string {
  return `${channel}:${externalId}`;
}

/**
 * The platform posts a set of Markaestro posts landed on. A native post whose
 * key is in this set is the same post seen from the account side (Markaestro
 * published it, or the person marked it posted by hand), and the `posts`
 * row already represents it.
 */
export function markaestroPlatformPostKeys(posts: Iterable<{
  channel?: string;
  externalId?: string;
  publishResults?: Array<{ channel?: string; success?: boolean; externalId?: string }>;
}>): Set<string> {
  const keys = new Set<string>();
  for (const post of posts) {
    for (const entry of post.publishResults ?? []) {
      if (entry.success && entry.channel && entry.externalId) keys.add(platformPostKey(entry.channel, entry.externalId));
    }
    if (post.channel && post.externalId) keys.add(platformPostKey(post.channel, post.externalId));
  }
  return keys;
}

function nativeContentType(doc: NativeSocialPostDoc): PostContentType {
  switch (doc.contentType) {
    case 'text':
    case 'image':
    case 'video':
    case 'carousel':
      return doc.contentType;
    default:
      return doc.mediaUrl ? 'image' : 'text';
  }
}

/**
 * The analytics post shape (`query.ts` `postToRow` input) for a native post.
 * The platform is the only channel, the permalink is the live URL, and the
 * platform's own media type wins over guessing from URLs.
 */
export function nativePostToAnalyticsPost(doc: NativeSocialPostDoc & { platform: SocialChannel }): {
  source: 'native';
  content?: string;
  channel: SocialChannel;
  publishedChannels: SocialChannel[];
  publishedAt?: string;
  externalUrl?: string;
  productId?: string;
  contentTypeHint: PostContentType;
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  metricsUpdatedAt?: string;
} {
  return {
    source: 'native',
    content: doc.content ?? undefined,
    channel: doc.platform,
    publishedChannels: [doc.platform],
    publishedAt: doc.publishedAt ?? undefined,
    externalUrl: doc.permalink ?? undefined,
    productId: doc.productId ?? undefined,
    contentTypeHint: nativeContentType(doc),
    metricsByChannel: doc.metricsByChannel,
    metricsUpdatedAt: doc.metricsUpdatedAt,
  };
}

/**
 * The poll stage a native post starts at: -1 means "poll now, whatever the
 * post's age", written as the `discovered` snapshot. The regular stages
 * (1h ... 90d) follow from wherever the post's age falls; a post discovered
 * two days after publish gets `discovered`, then 72h, 7d, and so on.
 */
export const NATIVE_DISCOVERED_STAGE = -1;
export const NATIVE_DISCOVERED_STAGE_KEY = 'discovered';

/** Poll state a newly discovered native post starts with: due immediately. */
export function initialNativePollState(discoveredAtIso: string): Required<Pick<PostMetricsState, 'metricsStatus' | 'metricsPollStage' | 'metricsNextPollAt' | 'metricsAttempts'>> {
  return {
    metricsStatus: 'active',
    metricsPollStage: NATIVE_DISCOVERED_STAGE,
    metricsNextPollAt: discoveredAtIso,
    metricsAttempts: 0,
  };
}

/** The stage key a native snapshot is filed under. */
export function nativeStageKey(stage: number): string {
  if (stage < 0) return NATIVE_DISCOVERED_STAGE_KEY;
  return METRIC_POLL_STAGES[Math.min(stage, METRIC_POLL_STAGES.length - 1)].key;
}

/**
 * Store one observation of a native post's metrics as a stage snapshot under
 * the document, in the shape the history builder reads (`byChannel`) plus
 * the single-platform `metrics` the Intelligence readers use. Shared by the
 * scheduled poller and the on-demand refresh so both write the same thing.
 */
export async function recordNativeObservation(
  ref: FirebaseFirestore.DocumentReference,
  input: {
    channel: SocialChannel;
    stageKey: string;
    capturedAt: string;
    publishedAt: string | null;
    byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  },
): Promise<FirebaseFirestore.DocumentReference> {
  const snapshotRef = ref.collection('metrics').doc(input.stageKey);
  await snapshotRef.set({
    postId: ref.id,
    socialPostId: ref.id,
    platform: input.channel,
    stageKey: input.stageKey,
    capturedAt: input.capturedAt,
    publishedAt: input.publishedAt,
    byChannel: input.byChannel,
    metrics: input.byChannel[input.channel],
  });
  return snapshotRef;
}
