import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { attachPostThumbnails } from '@/lib/media/post-thumbnails';
import type { SocialChannel } from '@/lib/schemas';
import type { NormalizedPostMetrics, PlatformConnection, PlatformPostSummary } from '@/lib/platform/types';

export type SocialPostProvenance = 'markaestro' | 'platform_native';

export function canonicalSocialPostId(
  channel: SocialChannel,
  accountKey: string,
  externalId: string,
): string {
  return createHash('sha256')
    .update(`${channel}\0${accountKey}\0${externalId}`)
    .digest('base64url')
    .slice(0, 40);
}

export function socialPostAccountKey(connection: PlatformConnection): string {
  return connection.accountKey
    || String(connection.metadata.linkedinDestinationUrn || '')
    || String(connection.metadata.pageId || '')
    || String(connection.metadata.igAccountId || '')
    || String(connection.metadata.threadsUserId || '')
    || String(connection.metadata.openId || '')
    || String(connection.metadata.xUserId || '')
    || String(connection.metadata.username || '')
    || connection.provider;
}

export async function upsertMarkaestroSocialPost(input: {
  workspaceId: string;
  legacyPostId: string;
  productId?: string;
  campaignId?: string;
  channel: SocialChannel;
  externalId: string;
  publishedAt: string;
  content?: string;
  mediaUrls?: string[];
  /** Lets a video post carry its derived poster frame into the canonical row. */
  mediaAssetIds?: string[];
  connection: PlatformConnection;
  metrics: NormalizedPostMetrics;
  capturedAt: string;
  stageKey: string;
}): Promise<string> {
  const key = socialPostAccountKey(input.connection);
  const id = canonicalSocialPostId(input.channel, key, input.externalId);
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/socialPosts/${id}`);
  const snapshotId = createHash('sha256')
    .update(`${input.capturedAt}\0${input.stageKey}\0${input.externalId}`)
    .digest('base64url')
    .slice(0, 32);
  const now = input.capturedAt;
  const [existing, [withThumbnail]] = await Promise.all([
    ref.get(),
    attachPostThumbnails(input.workspaceId, [{ id: input.legacyPostId, mediaUrls: input.mediaUrls ?? [], mediaAssetIds: input.mediaAssetIds ?? [] }]),
  ]);
  const batch = adminDb.batch();
  batch.set(ref, {
    id,
    workspaceId: input.workspaceId,
    productId: input.productId ?? null,
    campaignId: input.campaignId ?? null,
    markaestroPostId: input.legacyPostId,
    provenance: 'markaestro' satisfies SocialPostProvenance,
    platform: input.channel,
    provider: input.connection.provider,
    accountKey: key,
    accountUsername: String(input.connection.metadata.username || input.connection.metadata.displayName || '').trim() || null,
    externalId: input.externalId,
    content: input.content ?? null,
    mediaUrls: input.mediaUrls ?? [],
    ...(withThumbnail?.thumbnailUrl ? { thumbnailUrl: withThumbnail.thumbnailUrl } : {}),
    publishedAt: input.publishedAt,
    latestMetrics: input.metrics,
    metricsUpdatedAt: now,
    updatedAt: now,
    ...(!existing.exists ? { firstSeenAt: now } : {}),
    schemaVersion: 1,
  }, { merge: true });
  batch.set(ref.collection('metrics').doc(snapshotId), {
    snapshotId,
    socialPostId: id,
    platform: input.channel,
    capturedAt: now,
    stageKey: input.stageKey,
    metrics: input.metrics,
    schemaVersion: 1,
  });
  await batch.commit();
  return id;
}

export function nativeSocialPostFields(input: {
  existing?: FirebaseFirestore.DocumentData;
  workspaceId: string;
  productId?: string;
  connection: PlatformConnection;
  post: PlatformPostSummary;
  discoveredAt: string;
}): Record<string, unknown> {
  const key = socialPostAccountKey(input.connection);
  const keepMarkaestro = input.existing?.provenance === 'markaestro';
  return {
    id: canonicalSocialPostId(input.post.channel, key, input.post.externalId),
    workspaceId: input.workspaceId,
    productId: input.productId ?? input.connection.productId ?? input.existing?.productId ?? null,
    campaignId: keepMarkaestro ? input.existing?.campaignId ?? null : null,
    markaestroPostId: keepMarkaestro ? input.existing?.markaestroPostId ?? null : null,
    provenance: keepMarkaestro ? 'markaestro' satisfies SocialPostProvenance : 'platform_native' satisfies SocialPostProvenance,
    platform: input.post.channel,
    provider: input.connection.provider,
    accountKey: key,
    accountUsername: String(input.connection.metadata.username || input.connection.metadata.displayName || input.existing?.accountUsername || '').trim() || null,
    externalId: input.post.externalId,
    content: keepMarkaestro ? (input.existing?.content ?? input.post.content) : input.post.content,
    contentType: input.post.mediaType,
    mediaUrl: input.post.mediaUrl,
    thumbnailUrl: input.post.thumbnailUrl,
    permalink: input.post.permalink,
    publishedAt: input.post.publishedAt || input.existing?.publishedAt || null,
    deletedAt: null,
    discoveredAt: input.discoveredAt,
    updatedAt: input.discoveredAt,
    ...(!input.existing ? { firstSeenAt: input.discoveredAt } : {}),
    schemaVersion: 1,
  };
}

export async function upsertNativeSocialPost(input: {
  workspaceId: string;
  productId?: string;
  connection: PlatformConnection;
  post: PlatformPostSummary;
  discoveredAt: string;
}): Promise<string> {
  const key = socialPostAccountKey(input.connection);
  const id = canonicalSocialPostId(input.post.channel, key, input.post.externalId);
  const ref = adminDb.doc(`workspaces/${input.workspaceId}/socialPosts/${id}`);
  const existing = await ref.get();
  await ref.set(nativeSocialPostFields({
    existing: existing.exists ? existing.data() : undefined,
    workspaceId: input.workspaceId,
    productId: input.productId,
    connection: input.connection,
    post: input.post,
    discoveredAt: input.discoveredAt,
  }), { merge: true });
  return id;
}
