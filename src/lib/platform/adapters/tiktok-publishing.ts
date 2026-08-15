import { fetchWithRetry } from '@/lib/fetch-retry';
import { isTikTokVideoUrl, validateTikTokMediaUrls } from '@/lib/tiktok-draft-flow';
import { publishTikTokDirectPost } from './tiktok-direct-post';
import {
  TIKTOK_API,
  buildTikTokMediaProxyUrl,
  downloadVideoForTikTokUpload,
  getTikTokFileUploadPlan,
  parseTikTokError,
  uploadTikTokVideoBytes,
} from './tiktok-media';
import { emptyMetrics, getAccessToken, metricNum } from '../base-adapter';
import { PlatformCapability } from '../types';
import type {
  AudienceFetchResult,
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
import { asTikTokSettings } from '@/lib/public-api/post-settings';
import { logger } from '@/lib/logger';

// Re-exported so existing import sites (and tests) keep resolving it here
// after the low-level upload primitives moved to `tiktok-media.ts`.
export { getTikTokFileUploadPlan };

type TikTokPublishStatus =
  | 'PROCESSING_UPLOAD'
  | 'PROCESSING_DOWNLOAD'
  | 'SEND_TO_USER_INBOX'
  | 'PUBLISH_COMPLETE'
  | 'FAILED';

type TikTokPublishStatusResult = {
  status?: TikTokPublishStatus | string;
  publiclyAvailablePostId?: string;
  failReason?: string;
  uploadedBytes?: number;
  downloadedBytes?: number;
  error?: string;
};

/**
 * TikTok's video/post IDs are 19-digit snowflake integers — well past
 * Number.MAX_SAFE_INTEGER (~16 digits). TikTok sends them as bare JSON
 * numbers, so `res.json()` silently rounds the low digits (confirmed
 * against real accounts: the status-fetch response's id consistently
 * diverges from the same video's id in video/list, always in the last
 * 3-4 digits — classic float64 rounding). Pull the exact digit string
 * out of the raw response body before JSON parsing gets anywhere near it.
 */
function extractRawTikTokPostId(rawText: string): string | undefined {
  const match = rawText.match(/"(?:publicaly_available_post_id|publicly_available_post_id)"\s*:\s*\[?\s*"?(\d+)"?\s*\]?/);
  return match?.[1];
}

export async function fetchTikTokPublishStatus(
  accessToken: string,
  publishId: string,
): Promise<TikTokPublishStatusResult> {
  const res = await fetchWithRetry(`${TIKTOK_API}/post/publish/status/fetch/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ publish_id: publishId }),
  });

  const rawText = await res.text();
  const data = JSON.parse(rawText || '{}');
  const error = parseTikTokError(data);
  if (error) return { error };

  return {
    status: data.data?.status as string | undefined,
    publiclyAvailablePostId: extractRawTikTokPostId(rawText),
    failReason: data.data?.fail_reason as string | undefined,
    uploadedBytes: typeof data.data?.uploaded_bytes === 'number' ? data.data.uploaded_bytes : undefined,
    downloadedBytes: typeof data.data?.downloaded_bytes === 'number' ? data.data.downloaded_bytes : undefined,
  };
}

async function initTikTokFileUpload(
  accessToken: string,
  videoSize: number,
): Promise<{ publishId: string; uploadUrl: string; chunkSize: number; totalChunkCount: number } | { error: string }> {
  const plan = getTikTokFileUploadPlan(videoSize);
  const initRes = await fetchWithRetry(`${TIKTOK_API}/post/publish/inbox/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount,
      },
    }),
  });

  const initData = await initRes.json();
  const initError = parseTikTokError(initData);
  if (initError) {
    return { error: initError };
  }

  const publishId = initData.data?.publish_id as string | undefined;
  const uploadUrl = initData.data?.upload_url as string | undefined;
  if (!publishId || !uploadUrl) {
    return { error: 'TikTok did not return a file upload URL' };
  }

  return { publishId, uploadUrl, chunkSize: plan.chunkSize, totalChunkCount: plan.totalChunkCount };
}

async function uploadVideoFileToTikTokInbox(
  accessToken: string,
  mediaUrl: string,
): Promise<{ publishId?: string; error?: string }> {
  const video = await downloadVideoForTikTokUpload(mediaUrl);
  if ('error' in video) {
    return { error: video.error };
  }

  const init = await initTikTokFileUpload(accessToken, video.buffer.byteLength);
  if ('error' in init) {
    return { error: init.error };
  }

  const upload = await uploadTikTokVideoBytes(
    init.uploadUrl,
    video.buffer,
    video.contentType,
    init.chunkSize,
    init.totalChunkCount,
  );
  if ('error' in upload) {
    return { error: upload.error };
  }

  return { publishId: init.publishId };
}

async function uploadVideoToTikTokInbox(
  accessToken: string,
  mediaUrl: string,
): Promise<{ publishId?: string; error?: string }> {
  // Always download + transcode + upload via FILE_UPLOAD. PULL_FROM_URL would
  // be faster (TikTok pulls the bytes directly) but it doesn't let us
  // normalize frame rate, so AI-generated content (typically 8–16 fps) gets
  // rejected with "frame rate check failed". Trade ~5–15s of upload latency
  // for 100% compatibility.
  return uploadVideoFileToTikTokInbox(accessToken, mediaUrl);
}

// ── Metrics ─────────────────────────────────────────────────────────

/**
 * Display API video counters — the complete set (no saves/reach/watch-time
 * without a TikTok Business account). Requires the `video.list` scope.
 */
async function fetchTikTokMetrics(
  connection: PlatformConnection,
  videoId: string,
): Promise<MetricsFetchResult> {
  const accessToken = getAccessToken(connection);
  const res = await fetchWithRetry(
    `${TIKTOK_API}/video/query/?fields=id,like_count,comment_count,share_count,view_count`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ filters: { video_ids: [videoId] } }),
    },
    { maxRetries: 1 },
  );
  const data = await res.json().catch(() => ({}));
  const error = parseTikTokError(data);
  if (error || !res.ok) {
    const code = (data.error?.code as string | undefined) || '';
    // video.list is an approved scope on our TikTok app; scope_not_authorized
    // here means this specific connection predates it and needs a reconnect
    // to pick it up, not that TikTok categorically disallows it.
    const reason = res.status === 401 || code === 'access_token_invalid' || code === 'token_expired'
      || code === 'scope_not_authorized' || code === 'scope_permission_missed'
      ? 'auth'
      : 'transient';
    return { ok: false, error: error || `TikTok video query failed (HTTP ${res.status})`, reason };
  }

  // Trust the server-side video_ids filter rather than re-matching `v.id`
  // ourselves: TikTok's ids are 19-digit integers that res.json() silently
  // rounds (past Number.MAX_SAFE_INTEGER), so a same-value string
  // comparison against our precisely-stored videoId would spuriously fail
  // even when TikTok correctly returned the requested video.
  const video = (data.data?.videos as Array<Record<string, unknown>> | undefined)?.[0];
  if (!video) {
    // The stored ID may still be an inbox publish_id (user never finalized the
    // post in TikTok) or the video was deleted — either way, nothing to poll.
    return { ok: false, error: 'Video not found on TikTok', reason: 'not_found' };
  }

  const metrics = emptyMetrics();
  metrics.views = metricNum(video.view_count);
  metrics.videoViews = metricNum(video.view_count);
  metrics.likes = metricNum(video.like_count);
  metrics.comments = metricNum(video.comment_count);
  metrics.shares = metricNum(video.share_count);
  metrics.raw = Object.fromEntries(
    ['view_count', 'like_count', 'comment_count', 'share_count']
      .map((k) => [k, metricNum(video[k])] as const)
      .filter((entry): entry is [string, number] => entry[1] !== null),
  );
  return { ok: true, metrics };
}

// ── Platform post management (list only — TikTok has no delete API) ─

const DEFAULT_LIST_LIMIT = 20;
/** TikTok's video/list max_count ceiling. */
const MAX_LIST_LIMIT = 20;

function classifyTikTokListError(status: number, code: string): 'auth' | 'unsupported' | 'transient' {
  // video.list is an approved scope on our TikTok app; scope_not_authorized
  // here means this specific connection predates it and needs a reconnect
  // to pick it up, not that TikTok categorically disallows it.
  if (
    status === 401
    || code === 'access_token_invalid'
    || code === 'token_expired'
    || code === 'scope_not_authorized'
    || code === 'scope_permission_missed'
  ) return 'auth';
  return 'transient';
}

/** Display API video list — requires the `video.list` scope. */
async function listTikTokVideos(
  connection: PlatformConnection,
  input: ListPostsInput,
): Promise<ListPostsResult> {
  const accessToken = getAccessToken(connection);
  const maxCount = Math.min(Math.max(1, Math.floor(input.limit || DEFAULT_LIST_LIMIT)), MAX_LIST_LIMIT);
  const body: Record<string, unknown> = { max_count: maxCount };
  if (input.cursor && /^\d+$/.test(input.cursor)) {
    body.cursor = Number(input.cursor);
  }

  const res = await fetchWithRetry(
    `${TIKTOK_API}/video/list/?fields=id,title,video_description,create_time,cover_image_url,share_url`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(body),
    },
    { maxRetries: 1 },
  );
  const rawText = await res.text();
  const data = JSON.parse(rawText || '{}');
  const error = parseTikTokError(data);
  if (error || !res.ok) {
    const code = (data.error?.code as string | undefined) || '';
    return {
      ok: false,
      error: error || `TikTok video list failed (HTTP ${res.status})`,
      reason: classifyTikTokListError(res.status, code),
    };
  }

  // Same precision-loss risk as fetchTikTokPublishStatus: pull each video's
  // exact id from the raw body rather than the JSON.parse'd (float-rounded)
  // value. Order is preserved by both the filter and the regex scan, so
  // zipping by index lines them back up.
  const rawIds = Array.from(rawText.matchAll(/"id"\s*:\s*"?(\d+)"?/g), (m) => m[1]);
  const videos = (data.data?.videos as Array<Record<string, unknown>> | undefined) ?? [];
  const posts: PlatformPostSummary[] = videos
    .filter((video) => video.id !== undefined && video.id !== null)
    .map((video, index) => {
      const createTime = metricNum(video.create_time);
      const description = typeof video.video_description === 'string' && video.video_description
        ? video.video_description
        : typeof video.title === 'string' ? video.title : null;
      return {
        externalId: rawIds[index] ?? String(video.id),
        channel: 'tiktok' as const,
        content: description,
        mediaType: 'video' as const,
        mediaUrl: null,
        thumbnailUrl: typeof video.cover_image_url === 'string' ? video.cover_image_url : null,
        permalink: typeof video.share_url === 'string' ? video.share_url : null,
        publishedAt: createTime !== null ? new Date(createTime * 1000).toISOString() : null,
        // TikTok's public API has no video-delete endpoint.
        canDelete: false,
      };
    });

  const hasMore = data.data?.has_more === true;
  const cursor = metricNum(data.data?.cursor);
  return {
    ok: true,
    posts,
    nextCursor: hasMore && cursor !== null ? String(cursor) : undefined,
  };
}

/** Requires the `user.info.stats` scope; returns unsupported when not granted. */
async function fetchTikTokAudience(connection: PlatformConnection): Promise<AudienceFetchResult> {
  const accessToken = getAccessToken(connection);
  const res = await fetchWithRetry(
    `${TIKTOK_API}/user/info/?fields=follower_count`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const data = await res.json().catch(() => ({}));
  const error = parseTikTokError(data);
  if (error || !res.ok) {
    const code = (data.error?.code as string | undefined) || '';
    const reason = res.status === 401 || code === 'access_token_invalid' || code === 'token_expired'
      ? 'auth'
      : code === 'scope_not_authorized' || code === 'scope_permission_missed'
        ? 'unsupported'
        : 'transient';
    return { ok: false, error: error || `HTTP ${res.status}`, reason };
  }
  const followers = metricNum(data.data?.user?.follower_count);
  if (followers === null) {
    return { ok: false, error: 'follower_count not returned (user.info.stats scope missing?)', reason: 'unsupported' };
  }
  return { ok: true, followers };
}

export const tiktokPublishingAdapter: PlatformAdapter = {
  id: 'tiktok-publishing',
  name: 'TikTok',
  channels: ['tiktok'],
  capabilities: [
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_VIDEO,
  ],

  async publish(connection: PlatformConnection, request: PublishRequest): Promise<PublishResult> {
    const accessToken = getAccessToken(connection);
    const validationError = validateTikTokMediaUrls(request.mediaUrls);
    if (validationError) {
      return {
        success: false,
        error: validationError,
      };
    }

    const mediaUrls = request.mediaUrls || [];
    const videoUrls = mediaUrls.filter((url) => isTikTokVideoUrl(url));
    const imageUrls = mediaUrls.filter((url) => !isTikTokVideoUrl(url));
    const tiktokSettings = asTikTokSettings(request.settings);
    const photoCoverIndex = tiktokSettings?.photoCoverIndex ?? request.photoCoverIndex ?? 0;

    try {
      // Direct Post is opt-in per post and never the fallback: only an
      // explicit `postMode: 'direct_post'` takes this branch, so every
      // existing post keeps the inbox hand-off below.
      if (tiktokSettings?.postMode === 'direct_post') {
        const result = await publishTikTokDirectPost({
          accessToken,
          content: request.content,
          videoUrls,
          imageUrls,
          photoCoverIndex,
          settings: tiktokSettings,
        });

        if ('error' in result) {
          return { success: false, error: `TikTok Direct Post failed: ${result.error}` };
        }

        logger.info('tiktok direct post initiated', {
          event: 'platform.tiktok.direct_post_initiated',
          publishId: result.publishId,
          privacyLevel: tiktokSettings.privacyLevel,
          mediaKind: videoUrls.length === 1 ? 'video' : 'photo',
        });

        // Same reconciliation path as the inbox flow — the poll worker and
        // webhook move the post to `published` on PUBLISH_COMPLETE.
        return {
          success: false,
          pending: true,
          externalId: result.publishId,
        };
      }

      if (videoUrls.length === 1) {
        const result = await uploadVideoToTikTokInbox(accessToken, videoUrls[0]);
        if (result.error) {
          return { success: false, error: `TikTok publish failed: ${result.error}` };
        }

        // Hand off to the background reconciler. The TikTok inbox transcode
        // typically resolves in 15–45s and is picked up by the Cloud Scheduler
        // poll worker (and the inline short-poll in the publish route for dev).
        return {
          success: false,
          pending: true,
          externalId: result.publishId || '',
        };
      }

      // Photo carousel path uses MEDIA_UPLOAD (video.upload scope). Content
      // lands in the user's TikTok inbox; they finalize caption/privacy and
      // post from the app. PULL_FROM_URL still requires a verified domain, so
      // Firebase URLs are proxied through our own domain via /api/media/proxy.
      const proxyUrls = imageUrls.map((url) => buildTikTokMediaProxyUrl(url, 'image'));

      // privacy_level / disable_comment / disable_duet / disable_stitch only
      // take effect in Direct Post mode. This is the inbox hand-off, where
      // the creator picks all of them in the TikTok app, so TikTok ignores
      // whatever we send. Log it so an integrator who set them on an inbox
      // post can see why they had no effect.
      if (tiktokSettings && (
        tiktokSettings.privacyLevel
        || tiktokSettings.disableComment !== undefined
        || tiktokSettings.disableDuet !== undefined
        || tiktokSettings.disableStitch !== undefined
      )) {
        logger.info('tiktok settings ignored (MEDIA_UPLOAD inbox flow)', {
          event: 'platform.tiktok.settings_ignored',
          settings: tiktokSettings,
        });
      }

      const body: Record<string, unknown> = {
        post_info: {
          title: request.content.substring(0, 90),
          description: request.content.substring(0, 4000),
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: photoCoverIndex,
          photo_images: proxyUrls,
        },
        post_mode: 'MEDIA_UPLOAD',
        media_type: 'PHOTO',
      };

      const res = await fetchWithRetry(`${TIKTOK_API}/post/publish/content/init/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      const error = parseTikTokError(data);
      if (error) {
        return { success: false, error: `TikTok publish failed: ${error}` };
      }

      const publishId = data.data?.publish_id as string | undefined;
      if (!publishId) {
        return { success: false, error: 'TikTok did not return a publish ID' };
      }

      return {
        success: false,
        pending: true,
        externalId: publishId,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown TikTok publishing error',
      };
    }
  },

  async fetchMetrics(connection: PlatformConnection, input: MetricsFetchInput): Promise<MetricsFetchResult> {
    try {
      return await fetchTikTokMetrics(connection, input.externalId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'TikTok metrics fetch failed', reason: 'transient' };
    }
  },

  async fetchAudience(connection: PlatformConnection): Promise<AudienceFetchResult> {
    try {
      return await fetchTikTokAudience(connection);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'TikTok audience fetch failed', reason: 'transient' };
    }
  },

  async listPosts(connection: PlatformConnection, input: ListPostsInput): Promise<ListPostsResult> {
    try {
      return await listTikTokVideos(connection, input);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'TikTok video list failed', reason: 'transient' };
    }
  },

  async deletePost(): Promise<DeletePostResult> {
    return {
      ok: false,
      error: 'TikTok does not allow apps to delete videos. Remove it from the TikTok app instead.',
      reason: 'unsupported',
    };
  },

  async testConnection(connection: PlatformConnection) {
    const accessToken = getAccessToken(connection);
    try {
      const res = await fetchWithRetry(
        `${TIKTOK_API}/user/info/?fields=open_id,display_name,avatar_url`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const data = await res.json();
      const error = parseTikTokError(data);
      if (error) return { ok: false, error };

      return { ok: true, label: 'Connected' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'TikTok connection test failed' };
    }
  },

  validateConnection() {
    return null;
  },
};
