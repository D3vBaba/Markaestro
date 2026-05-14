import { decrypt } from '@/lib/crypto';
import { getAccessToken, getMeta } from '../base-adapter';
import { graphApiFetch, checkIgPublishingQuota, checkPagePublishingAccess } from '../meta-graph-api';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';
import type { SocialChannel } from '@/lib/schemas';
import { asInstagramSettings, type InstagramSettings } from '@/lib/public-api/post-settings';

const GRAPH_API = 'https://graph.facebook.com/v22.0';
const INSTAGRAM_GRAPH_API = 'https://graph.instagram.com/v25.0';
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_MAX_ATTEMPTS = 15;

/** Minimum remaining IG publishing quota to allow a new publish. */
const IG_QUOTA_MIN_REMAINING = 3;

/** Video containers take longer to process than images. */
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_POLL_MAX_ATTEMPTS = 60; // ~5 minutes

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/.test(lower) || lower.includes('/videos/');
}

// ── Instagram helpers ───────────────────────────────────────────────

async function waitForContainer(
  graphApi: string,
  containerId: string,
  accessToken: string,
  options?: { intervalMs?: number; maxAttempts?: number },
): Promise<{ ready: boolean; error?: string }> {
  const pollInterval = options?.intervalMs ?? CONTAINER_POLL_INTERVAL_MS;
  const pollMax = options?.maxAttempts ?? CONTAINER_POLL_MAX_ATTEMPTS;
  for (let i = 0; i < pollMax; i++) {
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
    await new Promise((r) => setTimeout(r, pollInterval));
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
    // Video post: use /{pageId}/videos with file_url
    const firstMedia = mediaUrls[0];
    if (firstMedia && isVideoUrl(firstMedia)) {
      const res = await graphApiFetch(`${GRAPH_API}/${pageId}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: firstMedia,
          description: content,
          access_token: accessToken,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: `Facebook video error: ${err.error?.message || res.statusText}` };
      }
      const data = await res.json();
      const videoId = data.id;
      return {
        success: true,
        externalId: videoId,
        externalUrl: videoId ? `https://www.facebook.com/${pageId}/videos/${videoId}/` : undefined,
      };
    }

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

/** Create an Instagram media container for image or video. For carousel children, pass isCarouselItem=true and omit caption. */
async function createIgMediaContainer(
  graphApi: string,
  igAccountId: string,
  accessToken: string,
  params: {
    imageUrl?: string;
    videoUrl?: string;
    caption?: string;
    isCarouselItem?: boolean;
    isStory?: boolean;
    altText?: string;
    collaborators?: string[];
  },
): Promise<{ id?: string; error?: string }> {
  const body: Record<string, unknown> = {
    access_token: accessToken,
  };
  if (params.videoUrl) {
    // Standalone video → REELS (or STORIES); carousel child → VIDEO
    body.media_type = params.isCarouselItem
      ? 'VIDEO'
      : params.isStory
        ? 'STORIES'
        : 'REELS';
    body.video_url = params.videoUrl;
  } else if (params.imageUrl) {
    if (params.isStory) body.media_type = 'STORIES';
    body.image_url = params.imageUrl;
  }
  if (params.caption != null) body.caption = params.caption;
  if (params.isCarouselItem) body.is_carousel_item = true;
  if (params.altText) body.alt_text = params.altText;
  if (params.collaborators && params.collaborators.length > 0) {
    // IG Graph accepts up to 3 collaborators by username, JSON-encoded.
    body.collaborators = JSON.stringify(params.collaborators.slice(0, 3));
  }

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
  mediaUrls: string[] = [],
  settings?: InstagramSettings,
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

  if (mediaUrls.length === 0) {
    return { success: false, error: 'Instagram requires media (image or video). Text-only posts are not supported.' };
  }

  // Instagram carousel limit: 10
  if (mediaUrls.length > 10) {
    mediaUrls = mediaUrls.slice(0, 10);
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

  const isStory = settings?.postType === 'story';
  if (isStory && mediaUrls.length > 1) {
    return { success: false, error: 'Instagram stories support a single image or video, not carousels.' };
  }
  const altTexts = settings?.altText ?? [];
  const collaborators = settings?.collaborators;

  try {
    let containerId: string | undefined;
    const hasVideo = mediaUrls.some(isVideoUrl);
    const videoPollOptions = { intervalMs: VIDEO_POLL_INTERVAL_MS, maxAttempts: VIDEO_POLL_MAX_ATTEMPTS };

    if (mediaUrls.length === 1) {
      // Single media post (image, Reels video, or Story)
      const url = mediaUrls[0];
      const containerParams = isVideoUrl(url)
        ? { videoUrl: url, caption: content, isStory, collaborators }
        : { imageUrl: url, caption: content, isStory, altText: altTexts[0], collaborators };
      const single = await createIgMediaContainer(graphApi, igAccountId, accessToken, containerParams);
      if (single.error) {
        return { success: false, error: `Instagram container error: ${single.error}` };
      }
      containerId = single.id;
    } else {
      // Carousel: create one child container per media item (image or video).
      // alt_text is set per child where provided; collaborators are set on the parent only.
      const children = await Promise.all(
        mediaUrls.map((url, idx) => {
          const childParams = isVideoUrl(url)
            ? { videoUrl: url, isCarouselItem: true as const }
            : { imageUrl: url, isCarouselItem: true as const, altText: altTexts[idx] };
          return createIgMediaContainer(graphApi, igAccountId, accessToken, childParams);
        }),
      );
      const childFail = children.find((c) => c.error);
      if (childFail) {
        return { success: false, error: `Instagram carousel child error: ${childFail.error}` };
      }
      const childIds = children.map((c) => c.id).filter((id): id is string => !!id);

      // Wait for each child — use longer timeout for video children
      for (let i = 0; i < childIds.length; i++) {
        const pollOptions = isVideoUrl(mediaUrls[i]) ? videoPollOptions : undefined;
        const { ready, error: pollError } = await waitForContainer(graphApi, childIds[i], accessToken, pollOptions);
        if (!ready) {
          return { success: false, error: `Instagram carousel child processing failed: ${pollError}` };
        }
      }

      const carouselBody: Record<string, unknown> = {
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption: content,
        access_token: accessToken,
      };
      if (collaborators && collaborators.length > 0) {
        carouselBody.collaborators = JSON.stringify(collaborators.slice(0, 3));
      }
      const parentRes = await graphApiFetch(`${graphApi}/${igAccountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(carouselBody),
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

    // Step 2: Wait for processing — use longer timeout for video
    const { ready, error: pollError } = await waitForContainer(
      graphApi, containerId, accessToken, hasVideo ? videoPollOptions : undefined,
    );
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
    PlatformCapability.PUBLISH_VIDEO,
    PlatformCapability.PUBLISH_CAROUSEL,
  ],

  async publish(connection: PlatformConnection, request: PublishRequest): Promise<PublishResult> {
    const mediaUrls = request.mediaUrls ?? [];
    if (request.channel === 'instagram') {
      return publishToInstagram(connection, request.content, mediaUrls, asInstagramSettings(request.settings));
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
