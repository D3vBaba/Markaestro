import { decrypt } from '@/lib/crypto';
import { emptyMetrics, getAccessToken, getMeta, metricNum } from '../base-adapter';
import { graphApiFetch, checkIgPublishingQuota, checkPagePublishingAccess } from '../meta-graph-api';
import { PlatformCapability } from '../types';
import type {
  AudienceFetchResult,
  DeletePostInput,
  DeletePostResult,
  ListPostsInput,
  ListPostsResult,
  MetricsFetchInput,
  MetricsFetchResult,
  PlatformAdapter,
  PlatformConnection,
  PlatformPostSummary,
  PublishRequest,
  PublishResult,
} from '../types';
import type { SocialChannel } from '@/lib/schemas';
import { asInstagramSettings, type InstagramSettings } from '@/lib/public-api/post-settings';
import {
  IG_LOGIN_UNSUPPORTED_MESSAGE,
  isInstagramGraphRefusal,
  isInstagramMethodTypeUnsupported,
} from '@/lib/oauth/instagram-errors';

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

/**
 * First re-check delay. An image container is usually FINISHED almost
 * immediately, so the old flat 2s sleep spent most of a publish waiting on a
 * container that was already done. Ramp from here up to the caller's interval
 * instead, which keeps the polite polling rate for genuinely slow (video)
 * containers while returning fast ones in a fraction of a second.
 */
const CONTAINER_POLL_FIRST_DELAY_MS = 300;

async function waitForContainer(
  graphApi: string,
  containerId: string,
  accessToken: string,
  options?: { intervalMs?: number; maxAttempts?: number },
): Promise<{ ready: boolean; error?: string }> {
  const pollInterval = options?.intervalMs ?? CONTAINER_POLL_INTERVAL_MS;
  const pollMax = options?.maxAttempts ?? CONTAINER_POLL_MAX_ATTEMPTS;
  // Budget the same total wait the flat interval used to allow, so a slow video
  // still gets its full window — only the distribution of checks changes.
  const deadline = Date.now() + pollInterval * pollMax;
  let delay = Math.min(CONTAINER_POLL_FIRST_DELAY_MS, pollInterval);

  for (;;) {
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
    if (Date.now() + delay >= deadline) {
      return { ready: false, error: 'Container processing timed out' };
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, pollInterval);
  }
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

/**
 * Resolve the Instagram professional-account ID to publish against for a
 * standalone Instagram Login connection.
 *
 * The OAuth token response's user_id is an app-scoped ID; older connections
 * stored it as igAccountId when the connect-time profile fetch failed. Content
 * publishing requires the professional-account ID (the `user_id` field of
 * GET /me), and POSTing /media with the app-scoped ID fails with code 100
 * "Unsupported request - method type: post". Ask /me at publish time and fall
 * back to the stored ID only when /me is unavailable.
 *
 * Returns `refused: true` when graph.instagram.com blanket-refuses the token
 * (account not eligible for the Instagram API) so callers can surface the
 * actionable reconnect message instead of the raw Graph error.
 */
async function resolveInstagramLoginPublishId(
  connection: PlatformConnection,
  accessToken: string,
): Promise<{ id: string; refused?: boolean }> {
  const storedId = getInstagramAccountId(connection);
  try {
    const res = await graphApiFetch(
      `${INSTAGRAM_GRAPH_API}/me?${new URLSearchParams({
        fields: 'user_id',
        access_token: accessToken,
      }).toString()}`,
      {},
      { maxRetries: 1 },
    );
    const data = await res.json();
    if (!res.ok) {
      return { id: storedId, refused: isInstagramGraphRefusal(data) };
    }
    const userId = typeof data.user_id === 'string' && data.user_id
      ? data.user_id
      : typeof data.user_id === 'number'
        ? String(data.user_id)
        : '';
    return { id: userId || storedId };
  } catch {
    return { id: storedId };
  }
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

/**
 * Turn a Graph error payload into a user-facing message. On the Instagram
 * Login host, a blanket code-100 refusal means the account can't use the
 * Instagram API — surface the actionable reconnect message instead of the
 * raw "Unsupported request - method type: <verb>".
 */
function igErrorMessage(graphApi: string, err: { error?: { code?: number; message?: string } }, fallback: string): string {
  if (graphApi === INSTAGRAM_GRAPH_API && isInstagramGraphRefusal(err)) {
    return IG_LOGIN_UNSUPPORTED_MESSAGE;
  }
  return err.error?.message || fallback;
}

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
    return { error: igErrorMessage(graphApi, err, res.statusText) };
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
  let igAccountId = getInstagramAccountId(connection);
  if (!igAccountId) {
    return {
      success: false,
      error: connection.provider === 'instagram'
        ? 'No Instagram professional account connected.'
        : 'No Instagram professional account connected.',
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

  if (connection.provider === 'instagram') {
    const resolved = await resolveInstagramLoginPublishId(connection, accessToken);
    if (resolved.refused) {
      return { success: false, error: IG_LOGIN_UNSUPPORTED_MESSAGE };
    }
    igAccountId = resolved.id || igAccountId;
  }

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
        return { success: false, error: `Instagram carousel container error: ${igErrorMessage(graphApi, err, parentRes.statusText)}` };
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
      return { success: false, error: `Instagram publish error: ${igErrorMessage(graphApi, err, publishRes.statusText)}` };
    }

    const publishData = await publishRes.json();
    const mediaId = publishData.id;
    const permalink = mediaId ? await getPermalink(graphApi, mediaId, accessToken) : undefined;

    return { success: true, externalId: mediaId, externalUrl: permalink };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown Instagram publishing error' };
  }
}

// ── Metrics ─────────────────────────────────────────────────────────

/**
 * Media insights metric set valid for FEED, REELS, and carousel parents on
 * Graph v22+/Instagram v25+. `impressions` was deprecated in v22 (Jan 2025);
 * `views` is the canonical view count for all media types.
 */
const IG_MEDIA_METRICS = 'views,reach,likes,comments,shares,saved,total_interactions';
const IG_MEDIA_METRICS_FALLBACK = 'reach,likes,comments,shares,saved';

/**
 * Facebook post insights after the 2024–2026 metric purges. The views family
 * (`post_media_view`, `post_total_media_view_unique`) replaced impressions/
 * reach; `post_clicks` and `post_video_views` still resolve on v25.
 */
const FB_POST_METRICS = 'post_media_view,post_total_media_view_unique,post_clicks,post_video_views';
const FB_POST_METRICS_FALLBACK = 'post_clicks,post_video_views';

type GraphError = { error?: { code?: number; error_subcode?: number; message?: string } };

function classifyGraphError(status: number, data: GraphError): 'auth' | 'not_found' | 'unsupported' | 'transient' {
  const code = data.error?.code;
  const message = data.error?.message || '';
  if (status === 401 || code === 190 || code === 102) return 'auth';
  if (code === 100 && /does not exist|cannot be loaded|unsupported get request/i.test(message)) return 'not_found';
  if (code === 10 || code === 200 || code === 3) return 'unsupported';
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613 || status >= 500) return 'transient';
  return 'transient';
}

function isInvalidMetricError(data: GraphError): boolean {
  return data.error?.code === 100 && /metric/i.test(data.error?.message || '');
}

type InsightEntry = { name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } };

function readInsights(data: { data?: InsightEntry[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of data.data ?? []) {
    if (!entry.name) continue;
    const value = metricNum(entry.total_value?.value ?? entry.values?.[0]?.value);
    if (value !== null) out[entry.name] = value;
  }
  return out;
}

async function fetchInsightsCall(
  graphApi: string,
  objectId: string,
  metrics: string,
  accessToken: string,
): Promise<{ ok: true; values: Record<string, number> } | { ok: false; status: number; data: GraphError }> {
  const useQueryToken = graphApi === INSTAGRAM_GRAPH_API;
  const url = `${graphApi}/${objectId}/insights?${new URLSearchParams({
    metric: metrics,
    ...(useQueryToken ? { access_token: accessToken } : {}),
  }).toString()}`;
  const res = await graphApiFetch(
    url,
    useQueryToken ? {} : { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, data };
  return { ok: true, values: readInsights(data) };
}

async function fetchInstagramMetrics(
  connection: PlatformConnection,
  mediaId: string,
): Promise<MetricsFetchResult> {
  const accessToken = resolveAccessToken(connection);
  const graphApi = getInstagramGraphApi(connection);

  let call = await fetchInsightsCall(graphApi, mediaId, IG_MEDIA_METRICS, accessToken);
  if (!call.ok && isInvalidMetricError(call.data)) {
    call = await fetchInsightsCall(graphApi, mediaId, IG_MEDIA_METRICS_FALLBACK, accessToken);
  }
  if (!call.ok) {
    return {
      ok: false,
      error: call.data.error?.message || `Instagram insights failed (HTTP ${call.status})`,
      reason: classifyGraphError(call.status, call.data),
    };
  }

  const v = call.values;
  const metrics = emptyMetrics();
  metrics.views = metricNum(v.views);
  metrics.reach = metricNum(v.reach);
  metrics.likes = metricNum(v.likes);
  metrics.comments = metricNum(v.comments);
  metrics.shares = metricNum(v.shares);
  metrics.saves = metricNum(v.saved);
  metrics.raw = v;
  return { ok: true, metrics };
}

async function fetchFacebookMetrics(
  connection: PlatformConnection,
  postId: string,
): Promise<MetricsFetchResult> {
  const accessToken = resolveAccessToken(connection);

  // Reactions/comments/shares are optional enrichment. Some otherwise-valid
  // Page tokens can read /insights but cannot read these post fields without
  // pages_read_user_content. Do not discard successful read_insights data just
  // because that separate permission was not granted.
  const fieldsRes = await graphApiFetch(
    `${GRAPH_API}/${postId}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const fieldsData = await fieldsRes.json().catch(() => ({}));

  const metrics = emptyMetrics();
  if (fieldsRes.ok) {
    metrics.likes = metricNum(fieldsData.reactions?.summary?.total_count);
    metrics.comments = metricNum(fieldsData.comments?.summary?.total_count);
    metrics.shares = metricNum(fieldsData.shares?.count) ?? (fieldsData.shares === undefined ? 0 : null);
  }

  let call = await fetchInsightsCall(GRAPH_API, postId, FB_POST_METRICS, accessToken);
  if (!call.ok && isInvalidMetricError(call.data)) {
    call = await fetchInsightsCall(GRAPH_API, postId, FB_POST_METRICS_FALLBACK, accessToken);
  }
  if (call.ok) {
    const v = call.values;
    metrics.views = metricNum(v.post_media_view);
    metrics.reach = metricNum(v.post_total_media_view_unique);
    metrics.clicks = metricNum(v.post_clicks);
    metrics.videoViews = metricNum(v.post_video_views);
    metrics.raw = v;
    return { ok: true, metrics };
  }

  // Preserve useful engagement data when Meta temporarily rejects or prunes
  // an insights metric. If neither source is readable, surface the insights
  // failure because read_insights is the primary capability of this method.
  if (fieldsRes.ok) return { ok: true, metrics };
  return {
    ok: false,
    error: call.data.error?.message
      || fieldsData.error?.message
      || `Facebook insights failed (HTTP ${call.status})`,
    reason: classifyGraphError(call.status, call.data),
  };
}

async function fetchMetaAudience(
  connection: PlatformConnection,
  channel: SocialChannel,
): Promise<AudienceFetchResult> {
  const accessToken = resolveAccessToken(connection);
  const graphApi = getInstagramGraphApi(connection);

  let url: string;
  if (channel === 'instagram') {
    if (connection.provider === 'instagram') {
      url = `${graphApi}/me?${new URLSearchParams({ fields: 'followers_count', access_token: accessToken }).toString()}`;
    } else {
      const igAccountId = getInstagramAccountId(connection);
      if (!igAccountId) return { ok: false, error: 'No Instagram account linked', reason: 'unsupported' };
      url = `${GRAPH_API}/${igAccountId}?fields=followers_count`;
    }
  } else {
    const pageId = getMeta(connection, 'pageId', '');
    if (!pageId) return { ok: false, error: 'No Facebook page selected', reason: 'unsupported' };
    url = `${GRAPH_API}/${pageId}?fields=followers_count`;
  }

  const useQueryToken = url.includes('access_token=');
  const res = await graphApiFetch(
    url,
    useQueryToken ? {} : { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data.error?.message || `HTTP ${res.status}`,
      reason: classifyGraphError(res.status, data),
    };
  }
  const followers = metricNum(data.followers_count);
  if (followers === null) return { ok: false, error: 'followers_count not returned', reason: 'unsupported' };
  return { ok: true, followers };
}

// ── Platform post management (list / delete) ───────────────────────

const DEFAULT_LIST_LIMIT = 24;
const MAX_LIST_LIMIT = 50;

function clampListLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIST_LIMIT);
}

const IG_MEDIA_LIST_FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
const FB_POST_LIST_FIELDS = 'id,message,created_time,permalink_url,full_picture,attachments{media_type}';

function mapFacebookAttachmentType(mediaType: string | undefined, hasPicture: boolean): PlatformPostSummary['mediaType'] {
  switch (mediaType) {
    case 'photo': return 'image';
    case 'video': case 'video_inline': case 'video_autoplay': return 'video';
    case 'album': return 'carousel';
    default: return hasPicture ? 'image' : 'text';
  }
}

function mapInstagramMediaType(mediaType: string | undefined): PlatformPostSummary['mediaType'] {
  switch (mediaType) {
    case 'IMAGE': return 'image';
    case 'VIDEO': return 'video';
    case 'CAROUSEL_ALBUM': return 'carousel';
    default: return 'unknown';
  }
}

type GraphPaging = { paging?: { cursors?: { after?: string }; next?: string } };

function graphNextCursor(data: GraphPaging): string | undefined {
  // Graph only includes `next` when another page exists; `after` alone can
  // point past the final item.
  return data.paging?.next && data.paging.cursors?.after ? data.paging.cursors.after : undefined;
}

async function listFacebookPosts(
  connection: PlatformConnection,
  input: ListPostsInput,
): Promise<ListPostsResult> {
  const pageId = getMeta(connection, 'pageId', '');
  if (!pageId) {
    return { ok: false, error: 'No Facebook page selected. Select a page in brand settings.', reason: 'unsupported' };
  }
  const accessToken = resolveAccessToken(connection);
  const params = new URLSearchParams({
    fields: FB_POST_LIST_FIELDS,
    limit: String(clampListLimit(input.limit)),
    ...(input.cursor ? { after: input.cursor } : {}),
  });
  const res = await graphApiFetch(
    `${GRAPH_API}/${pageId}/published_posts?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = classifyGraphError(res.status, data);
    return {
      ok: false,
      error: data.error?.message || `Facebook posts fetch failed (HTTP ${res.status})`,
      reason: reason === 'not_found' ? 'unsupported' : reason,
    };
  }

  const posts: PlatformPostSummary[] = ((data.data ?? []) as Array<Record<string, unknown>>)
    .filter((post) => typeof post.id === 'string' && post.id)
    .map((post) => {
      const attachment = (post.attachments as { data?: Array<{ media_type?: string }> } | undefined)?.data?.[0];
      const fullPicture = typeof post.full_picture === 'string' ? post.full_picture : null;
      return {
        externalId: String(post.id),
        channel: 'facebook' as const,
        content: typeof post.message === 'string' ? post.message : null,
        mediaType: mapFacebookAttachmentType(attachment?.media_type, Boolean(fullPicture)),
        mediaUrl: fullPicture,
        thumbnailUrl: fullPicture,
        permalink: typeof post.permalink_url === 'string' ? post.permalink_url : null,
        publishedAt: typeof post.created_time === 'string' ? new Date(post.created_time).toISOString() : null,
        canDelete: true,
      };
    });

  return { ok: true, posts, nextCursor: graphNextCursor(data) };
}

async function listInstagramMedia(
  connection: PlatformConnection,
  input: ListPostsInput,
): Promise<ListPostsResult> {
  const accessToken = resolveAccessToken(connection);
  const graphApi = getInstagramGraphApi(connection);
  const limit = String(clampListLimit(input.limit));

  let url: string;
  if (connection.provider === 'instagram') {
    // Instagram Login host authenticates via query token and resolves the
    // account through /me.
    url = `${INSTAGRAM_GRAPH_API}/me/media?${new URLSearchParams({
      fields: IG_MEDIA_LIST_FIELDS,
      limit,
      access_token: accessToken,
      ...(input.cursor ? { after: input.cursor } : {}),
    }).toString()}`;
  } else {
    const igAccountId = getInstagramAccountId(connection);
    if (!igAccountId) {
      return { ok: false, error: 'No Instagram professional account connected.', reason: 'unsupported' };
    }
    url = `${GRAPH_API}/${igAccountId}/media?${new URLSearchParams({
      fields: IG_MEDIA_LIST_FIELDS,
      limit,
      ...(input.cursor ? { after: input.cursor } : {}),
    }).toString()}`;
  }

  const res = await graphApiFetch(
    url,
    graphApi === INSTAGRAM_GRAPH_API ? {} : { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (graphApi === INSTAGRAM_GRAPH_API && isInstagramGraphRefusal(data)) {
      return { ok: false, error: IG_LOGIN_UNSUPPORTED_MESSAGE, reason: 'unsupported' };
    }
    const reason = classifyGraphError(res.status, data);
    return {
      ok: false,
      error: data.error?.message || `Instagram media fetch failed (HTTP ${res.status})`,
      reason: reason === 'not_found' ? 'unsupported' : reason,
    };
  }

  const posts: PlatformPostSummary[] = ((data.data ?? []) as Array<Record<string, unknown>>)
    .filter((media) => typeof media.id === 'string' && media.id)
    .map((media) => ({
      externalId: String(media.id),
      channel: 'instagram' as const,
      content: typeof media.caption === 'string' ? media.caption : null,
      mediaType: mapInstagramMediaType(typeof media.media_type === 'string' ? media.media_type : undefined),
      mediaUrl: typeof media.media_url === 'string' ? media.media_url : null,
      thumbnailUrl: typeof media.thumbnail_url === 'string'
        ? media.thumbnail_url
        : typeof media.media_url === 'string' ? media.media_url : null,
      permalink: typeof media.permalink === 'string' ? media.permalink : null,
      publishedAt: typeof media.timestamp === 'string' ? new Date(media.timestamp).toISOString() : null,
      // The Instagram API has no media-delete endpoint.
      canDelete: false,
    }));

  return { ok: true, posts, nextCursor: graphNextCursor(data) };
}

async function deleteFacebookPost(
  connection: PlatformConnection,
  postId: string,
): Promise<DeletePostResult> {
  const accessToken = resolveAccessToken(connection);
  const res = await graphApiFetch(
    `${GRAPH_API}/${encodeURIComponent(postId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data.error?.message || `Facebook post delete failed (HTTP ${res.status})`,
      reason: classifyGraphError(res.status, data),
    };
  }
  if (data.success === false) {
    return { ok: false, error: 'Facebook did not confirm the deletion', reason: 'transient' };
  }
  return { ok: true };
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

  async fetchMetrics(connection: PlatformConnection, input: MetricsFetchInput): Promise<MetricsFetchResult> {
    try {
      if (input.channel === 'instagram') {
        return await fetchInstagramMetrics(connection, input.externalId);
      }
      return await fetchFacebookMetrics(connection, input.externalId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Meta metrics fetch failed', reason: 'transient' };
    }
  },

  async fetchAudience(connection: PlatformConnection, channel: SocialChannel): Promise<AudienceFetchResult> {
    try {
      return await fetchMetaAudience(connection, channel);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Meta audience fetch failed', reason: 'transient' };
    }
  },

  async listPosts(connection: PlatformConnection, input: ListPostsInput): Promise<ListPostsResult> {
    try {
      if (input.channel === 'instagram') {
        return await listInstagramMedia(connection, input);
      }
      return await listFacebookPosts(connection, input);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Meta posts fetch failed', reason: 'transient' };
    }
  },

  async deletePost(connection: PlatformConnection, input: DeletePostInput): Promise<DeletePostResult> {
    if (input.channel === 'instagram') {
      return {
        ok: false,
        error: 'Instagram does not allow apps to delete posts. Remove it from the Instagram app instead.',
        reason: 'unsupported',
      };
    }
    try {
      return await deleteFacebookPost(connection, input.externalId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Facebook post delete failed', reason: 'transient' };
    }
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
          const igAccountId = getInstagramAccountId(connection);
          if (igAccountId && isInstagramMethodTypeUnsupported(err, 'get')) {
            const username = typeof connection.metadata.username === 'string' ? connection.metadata.username : '';
            return { ok: true, label: username || 'Instagram connected' };
          }
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
