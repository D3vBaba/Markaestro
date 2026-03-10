import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import type { SocialChannel } from '@/lib/schemas';
import type { PublishRequest, PublishResult, XConfig, FacebookConfig, InstagramConfig, TikTokConfig } from './types';
import { publishToX } from './x';
import { publishToFacebook } from './facebook';
import { publishToInstagram } from './instagram';
import { publishToTikTok } from './tiktok';

/**
 * Load integration config for a channel.
 * Social channels (facebook, instagram, tiktok, x) read from per-product path.
 * Falls back to legacy workspace-level path if no productId is provided.
 */
async function loadConfig(workspaceId: string, productId: string | undefined, channel: SocialChannel): Promise<Record<string, unknown> | null> {
  const basePath = productId
    ? `workspaces/${workspaceId}/products/${productId}/integrations`
    : `workspaces/${workspaceId}/integrations`;

  // For Facebook/Instagram, try unified Meta OAuth first
  if (channel === 'facebook' || channel === 'instagram') {
    const metaRef = adminDb.doc(`${basePath}/meta`);
    const metaSnap = await metaRef.get();
    if (metaSnap.exists) {
      const metaData = metaSnap.data() as Record<string, unknown>;
      if (metaData.enabled !== false && metaData.oauthConnected) {
        return { ...metaData, _source: 'meta' };
      }
    }
  }

  // For TikTok and X, check the OAuth integration directly
  if (channel === 'tiktok' || channel === 'x') {
    const ref = adminDb.doc(`${basePath}/${channel}`);
    const snap = await ref.get();
    if (!snap.exists) return null;
    return snap.data() as Record<string, unknown>;
  }

  // Legacy: direct per-channel lookup
  const ref = adminDb.doc(`${basePath}/${channel}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data() as Record<string, unknown>;
}

export async function publishPost(workspaceId: string, productId: string | undefined, request: PublishRequest): Promise<PublishResult> {
  const raw = await loadConfig(workspaceId, productId, request.channel);
  if (!raw || raw.enabled === false) {
    return { success: false, error: `${request.channel} integration is not configured or disabled` };
  }

  if (request.channel === 'x') {
    const config: XConfig = {
      accessToken: decrypt(raw.accessTokenEncrypted as string),
      username: (raw.username as string) || '',
    };
    return publishToX(config, request.content, request.mediaUrls);
  }

  if (request.channel === 'facebook') {
    const isMetaOAuth = raw._source === 'meta';
    const config: FacebookConfig = {
      // Prefer page access token (from Meta OAuth page selection) over user-level token
      accessToken: isMetaOAuth && raw.pageAccessTokenEncrypted
        ? decrypt(raw.pageAccessTokenEncrypted as string)
        : decrypt(raw.accessTokenEncrypted as string),
      pageId: raw.pageId as string || '',
    };
    return publishToFacebook(config, request.content, request.mediaUrls?.[0]);
  }

  if (request.channel === 'instagram') {
    const isMetaOAuth = raw._source === 'meta';
    const config: InstagramConfig = {
      accessToken: isMetaOAuth && raw.pageAccessTokenEncrypted
        ? decrypt(raw.pageAccessTokenEncrypted as string)
        : decrypt(raw.accessTokenEncrypted as string),
      igAccountId: raw.igAccountId as string || '',
    };
    const imageUrl = request.mediaUrls?.[0];
    return publishToInstagram(config, request.content, imageUrl);
  }

  if (request.channel === 'tiktok') {
    const config: TikTokConfig = {
      accessToken: decrypt(raw.accessTokenEncrypted as string),
      openId: raw.openId as string || '',
    };
    return publishToTikTok(config, request.content, request.mediaUrls?.[0]);
  }

  return { success: false, error: `Unsupported channel: ${request.channel}` };
}

/**
 * Process all scheduled posts that are due for publishing.
 */
export async function processScheduledPosts(workspaceId: string): Promise<{ processed: number; results: Array<{ postId: string; success: boolean; error?: string }> }> {
  const nowIso = new Date().toISOString();
  const postsRef = adminDb.collection(`workspaces/${workspaceId}/posts`);

  const snap = await postsRef
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '<=', nowIso)
    .limit(50)
    .get();

  const results: Array<{ postId: string; success: boolean; error?: string }> = [];

  for (const doc of snap.docs) {
    const post = doc.data();
    const postId = doc.id;
    const productId = post.productId as string | undefined;

    // Skip posts without a productId — they can't resolve a social integration
    if (!productId) {
      results.push({ postId, success: false, error: 'Post has no associated product' });
      continue;
    }

    // Mark as publishing
    await doc.ref.update({ status: 'publishing', updatedAt: new Date().toISOString() });

    const result = await publishPost(workspaceId, productId, {
      content: post.content,
      channel: post.channel,
      mediaUrls: post.mediaUrls,
    });

    if (result.success) {
      await doc.ref.update({
        status: 'published',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      await doc.ref.update({
        status: 'failed',
        errorMessage: result.error || 'Unknown error',
        updatedAt: new Date().toISOString(),
      });
    }

    results.push({ postId, success: result.success, error: result.error });
  }

  return { processed: results.length, results };
}
