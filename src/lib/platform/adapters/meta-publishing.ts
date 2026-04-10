import { fetchWithRetry } from '@/lib/fetch-retry';
import { decrypt } from '@/lib/crypto';
import { getAccessToken, getMeta } from '../base-adapter';
import { graphApiFetch, checkIgPublishingQuota, checkPagePublishingAccess } from '../meta-graph-api';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';
import type { SocialChannel } from '@/lib/schemas';

const GRAPH_API = 'https://graph.facebook.com/v22.0';
const INSTAGRAM_GRAPH_API = 'https://graph.instagram.com/v25.0';
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_MAX_ATTEMPTS = 15;

/** Minimum remaining IG publishing quota to allow a new publish. */
const IG_QUOTA_MIN_REMAINING = 3;

// ── Instagram helpers ───────────────────────────────────────────────

async function waitForContainer(
  graphApi: string,
  containerId: string,
  accessToken: string,
): Promise<{ ready: boolean; error?: string }> {
  for (let i = 0; i < CONTAINER_POLL_MAX_ATTEMPTS; i++) {
    const url = graphApi === INSTAGRAM_GRAPH_API
      ? `${graphApi}/${containerId}?${new URLSearchParams({
        fields: 'status_code,status',
        access_token: accessToken,
      }).toString()}`
      : `${graphApi}/${containerId}?fields=status_code,status`;
    const res = await graphApiFetch(
      url,
      graphApi === INSTAGRAM_GRAPH_API
        ? {}
        : { headers: { Authorization: `Bearer ${accessToken}` } },
      { maxRetries: 1 },
    );
    const data = await res.json();

    if (data.status_code === 'FINISHED') return { ready: true };
    if (data.status_code === 'ERROR') {
      return { ready: false, error: data.status || 'Container processing failed' };
    }
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL_MS));
  }
  return { ready: false, error: 'Container processing timed out' };
}

async function getPermalink(graphApi: string, mediaId: string, accessToken: string): Promise<string | undefined> {
  try {
    const url = graphApi === INSTAGRAM_GRAPH_API
      ? `${graphApi}/${mediaId}?${new URLSearchParams({
        fields: 'permalink',
        access_token: accessToken,
      }).toString()}`
      : `${graphApi}/${mediaId}?fields=permalink`;
    const res = await graphApiFetch(
      url,
      graphApi === INSTAGRAM_GRAPH_API
        ? {}
        : { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await res.json();
    return data.permalink || undefined;
  } catch {
    return undefined;
  }
}

// ── Resolve access token ────────────────────────────────────────────

function resolveAccessToken(connection: PlatformConnection): string {
  if (connection.provider === 'instagram') {
    return getAccessToken(connection);
  }
  // Prefer page access token (set when user selects a page)
  const pageTokenEncrypted = connection.metadata.pageAccessTokenEncrypted as string | undefined;
  if (pageTokenEncrypted) {
    return decrypt(pageTokenEncrypted);
  }
  // Fall back to user access token
  return getAccessToken(connection);
}

function getInstagramGraphApi(connection: PlatformConnection): string {
  return connection.provider === 'instagram' ? INSTAGRAM_GRAPH_API : GRAPH_API;
}

function getInstagramAccountId(connection: PlatformConnection): string {
  return getMeta(connection, 'igAccountId', '');
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Build a Facebook permalink from the Graph API post ID.
 * The API returns IDs in "{pageId}_{postId}" format.
 * Maps to: https://www.facebook.com/{pageId}/posts/{postId}
 */
function buildFacebookUrl(pageId: string, rawId: string): string {
  const parts = rawId.split('_');
  if (parts.length === 2) {
    return `https://www.facebook.com/${parts[0]}/posts/${parts[1]}`;
  }
  return `https://www.facebook.com/${rawId}`;
}

// ── Facebook publish ────────────────────────────────────────────────

/** Upload a photo to the page as unpublished, returning its media_fbid for attachment. */
async function uploadUnpublishedFacebookPhoto(
  pageId: string,
  accessToken: string,
  imageUrl: string,
): Promise<{ id?: string; error?: string }> {
  const res = await graphApiFetch(`${GRAPH_API}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl, published: false, access_token: accessToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { error: err.error?.message || res.statusText };
  }
  const data = await res.json();
  return { id: data.id };
}

async function publishToFacebook(
  connection: PlatformConnection,
  content: string,
  mediaUrls: string[] = [],
): Promise<PublishResult> {
  const pageId = getMeta(connection, 'pageId', '');
  if (!pageId) {
    return { success: false, error: 'No Facebook page selected. Go to Products > Integrations and select a Facebook page.' };
  }

  const accessToken = resolveAccessToken(connection);

  // Check Page Publishing Authorization before attempting to publish
  try {
    const ppa = await checkPagePublishingAccess(accessToken, pageId);
    if (!ppa.canPublish) {
      return { success: false, error: ppa.error || 'Page Publishing Authorization required' };
    }
  } catch {
    // PPA check is best-effort — don't block publish on check failure
  }

  try {
    // Multi-photo post: upload each unpublished, then attach to a single feed post.
    if (mediaUrls.length > 1) {
      const uploads = await Promise.all(
        mediaUrls.map((url) => uploadUnpublishedFacebookPhoto(pageId, accessToken, url)),
      );
      const failed = uploads.find((u) => u.error);
      if (failed) {
        return { success: false, error: `Facebook photo upload error: ${failed.error}` };
      }
      const attachedMedia = uploads
        .map((u) => u.id)
        .filter((id): id is string => !!id)
        .map((media_fbid) => ({ media_fbid }));

      const feedRes = await graphApiFetch(`${GRAPH_API}/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          attached_media: attachedMedia,
          access_token: accessToken,
        }),
      });
      if (!feedRes.ok) {
        const err = await feedRes.json().catch(() => ({}));
        return { success: false, error: `Facebook multi-photo post error: ${err.error?.message || feedRes.statusText}` };
      }
      const feedData = await feedRes.json();
      const postId = feedData.id;
      return {
        success: true,
        externalId: postId,
        externalUrl: postId ? buildFacebookUrl(pageId, postId) : undefined,
      };
    }

    const mediaUrl = mediaUrls[0];
    if (mediaUrl) {
      const res = await graphApiFetch(`${GRAPH_API}/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mediaUrl, message: content, access_token: accessToken }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: `Facebook photo error: ${err.error?.message || res.statusText}` };
      }

      const data = await res.json();
      const postId = data.post_id || data.id;
      return {
        success: true,
        externalId: postId,
        externalUrl: postId ? buildFacebookUrl(pageId, postId) : undefined,
      };
    }

    // Text-only
    const res = await graphApiFetch(`${GRAPH_API}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, access_token: accessToken }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: `Facebook API error: ${err.error?.message || res.statusText}` };
    }

    const data = await res.json();
    const postId = data.id;
    return {
      success: true,
      externalId: postId,
      externalUrl: postId ? buildFacebookUrl(pageId, postId) : undefined,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown Facebook publishing error' };
  }
}

// ── Instagram publish ───────────────────────────────────────────────

/** Create an Instagram media container. For carousel children, pass isCarouselItem=true and omit caption. */
async function createIgMediaContainer(
  graphApi: string,
  igAccountId: string,
  accessToken: string,
  params: { imageUrl: string; caption?: string; isCarouselItem?: boolean },
): Promise<{ id?: string; error?: string }> {
  const body: Record<string, unknown> = {
    image_url: params.imageUrl,
    access_token: accessToken,
  };
  if (params.caption != null) body.caption = params.caption;
  if (params.isCarouselItem) body.is_carousel_item = true;

  const res = await graphApiFetch(`${graphApi}/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { error: err.error?.message || res.statusText };
  }
  const data = await res.json();
  return { id: data.id };
}

async function publishToInstagram(
  connection: PlatformConnection,
  content: string,
  imageUrls: string[] = [],
): Promise<PublishResult> {
  const igAccountId = getInstagramAccountId(connection);
  if (!igAccountId) {
    return {
      success: false,
      error: connection.provider === 'instagram'
        ? 'No Instagram professional account connected.'
        : 'No Instagram account linked. Select a Facebook page with a linked Instagram business account.',
    };
  }

  if (imageUrls.length === 0) {
    return { success: false, error: 'Instagram requires an image URL. Text-only posts are not supported.' };
  }

  // Instagram carousel limit: 10
  if (imageUrls.length > 10) {
    imageUrls = imageUrls.slice(0, 10);
  }

  const accessToken = resolveAccessToken(connection);
  const graphApi = getInstagramGraphApi(connection);

  // Check Instagram publishing quota before creating containers
  try {
    const graphApiType = connection.provider === 'instagram' ? 'instagram' : 'facebook';
    const quota = await checkIgPublishingQuota(accessToken, igAccountId, graphApiType);
    if (quota.remaining < IG_QUOTA_MIN_REMAINING) {
      return {
        success: false,
        error: `Instagram publishing limit reached (${quota.quotaUsage}/${quota.quotaTotal} used in the last 24 hours). Try again later.`,
      };
    }
  } catch {
    // Quota check is best-effort — don't block on check failure
  }

  try {
    let containerId: string | undefined;

    if (imageUrls.length === 1) {
      // Single image post
      const single = await createIgMediaContainer(graphApi, igAccountId, accessToken, {
        imageUrl: imageUrls[0],
        caption: content,
      });
      if (single.error) {
        return { success: false, error: `Instagram container error: ${single.error}` };
      }
      containerId = single.id;
    } else {
      // Carousel: create one child container per image, then a parent carousel container
      const children = await Promise.all(
        imageUrls.map((imageUrl) =>
          createIgMediaContainer(graphApi, igAccountId, accessToken, { imageUrl, isCarouselItem: true }),
        ),
      );
      const childFail = children.find((c) => c.error);
      if (childFail) {
        return { success: false, error: `Instagram carousel child error: ${childFail.error}` };
      }
      const childIds = children.map((c) => c.id).filter((id): id is string => !!id);

      // Wait for each child to finish processing before attaching to the carousel
      for (const childId of childIds) {
        const { ready, error: pollError } = await waitForContainer(graphApi, childId, accessToken);
        if (!ready) {
          return { success: false, error: `Instagram carousel child processing failed: ${pollError}` };
        }
      }

      const parentRes = await graphApiFetch(`${graphApi}/${igAccountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children: childIds.join(','),
          caption: content,
          access_token: accessToken,
        }),
      });
      if (!parentRes.ok) {
        const err = await parentRes.json().catch(() => ({}));
        return { success: false, error: `Instagram carousel container error: ${err.error?.message || parentRes.statusText}` };
      }
      const parentData = await parentRes.json();
      containerId = parentData.id;
    }

    if (!containerId) {
      return { success: false, error: 'Failed to create Instagram media container' };
    }

    // Step 2: Wait for processing
    const { ready, error: pollError } = await waitForContainer(graphApi, containerId, accessToken);
    if (!ready) {
      return { success: false, error: `Instagram media processing failed: ${pollError}` };
    }

    // Step 3: Publish
    const publishRes = await graphApiFetch(`${graphApi}/${igAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
    });

    if (!publishRes.ok) {
      const err = await publishRes.json().catch(() => ({}));
      return { success: false, error: `Instagram publish error: ${err.error?.message || publishRes.statusText}` };
    }

    const publishData = await publishRes.json();
    const mediaId = publishData.id;
    const permalink = mediaId ? await getPermalink(graphApi, mediaId, accessToken) : undefined;

    return { success: true, externalId: mediaId, externalUrl: permalink };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown Instagram publishing error' };
  }
}

// ── Adapter ─────────────────────────────────────────────────────────

export const metaPublishingAdapter: PlatformAdapter = {
  id: 'meta-publishing',
  name: 'Meta (Facebook & Instagram)',
  channels: ['facebook', 'instagram'],
  capabilities: [
    PlatformCapability.PUBLISH_TEXT,
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_CAROUSEL,
  ],

  async publish(connection: PlatformConnection, request: PublishRequest): Promise<PublishResult> {
    const mediaUrls = request.mediaUrls ?? [];
    if (request.channel === 'instagram') {
      return publishToInstagram(connection, request.content, mediaUrls);
    }
    return publishToFacebook(connection, request.content, mediaUrls);
  },

  async testConnection(connection: PlatformConnection) {
    const accessToken = resolveAccessToken(connection);
    try {
      if (connection.provider === 'instagram') {
        const res = await graphApiFetch(
          `${INSTAGRAM_GRAPH_API}/me?${new URLSearchParams({
            fields: 'user_id,username',
            access_token: accessToken,
          }).toString()}`,
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { ok: false, error: err.error?.message || err.error_message || `HTTP ${res.status}` };
        }
        const data = await res.json();
        return { ok: true, label: data.username || 'Instagram connected' };
      }

      const res = await graphApiFetch(
        `${GRAPH_API}/me?fields=name,id`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.error?.message || `HTTP ${res.status}` };
      }
      const data = await res.json();
      return { ok: true, label: data.name || 'Connected' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Connection test failed' };
    }
  },

  validateConnection(connection: PlatformConnection, channel: SocialChannel): string | null {
    if (channel === 'facebook') {
      const pageId = getMeta(connection, 'pageId', '');
      if (!pageId) return 'No Facebook page selected';
    }
    if (channel === 'instagram') {
      const igAccountId = getInstagramAccountId(connection);
      if (!igAccountId) {
        return connection.provider === 'instagram'
          ? 'No Instagram professional account linked'
          : 'No Instagram business account linked';
      }
    }
    return null;
  },
};
