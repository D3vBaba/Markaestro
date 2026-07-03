import { fetchWithRetry } from '@/lib/fetch-retry';
import { detectMp4Audio } from '@/lib/media/mp4-audio-detect';
import { transcodeForTikTok } from '@/lib/media/tiktok-transcode';
import { readResponseBufferWithLimit } from '@/lib/network-security';
import { isTikTokVideoUrl, validateTikTokMediaUrls } from '@/lib/tiktok-draft-flow';
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

const TIKTOK_MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const TIKTOK_FILE_UPLOAD_TIMEOUT_MS = 120_000;
const TIKTOK_MAX_WHOLE_UPLOAD_BYTES = 64 * 1024 * 1024;
const TIKTOK_DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024;

export function getTikTokFileUploadPlan(videoSize: number) {
  if (videoSize <= 0) {
    throw new Error('TikTok video has no bytes to upload');
  }

  if (videoSize <= TIKTOK_MAX_WHOLE_UPLOAD_BYTES) {
    return {
      chunkSize: videoSize,
      totalChunkCount: 1,
    };
  }

  return {
    chunkSize: TIKTOK_DEFAULT_CHUNK_BYTES,
    totalChunkCount: Math.ceil(videoSize / TIKTOK_DEFAULT_CHUNK_BYTES),
  };
}

function isMp4LikeVideo(contentType: string, mediaUrl: string): boolean {
  const normalizedType = contentType.split(';', 1)[0].trim().toLowerCase();
  return normalizedType === 'video/mp4' ||
    normalizedType === 'video/quicktime' ||
    /\.(mp4|mov)(?:[?&]|$)/i.test(mediaUrl);
}

async function normalizeVideoForTikTokUpload(
  buffer: Buffer,
  contentType: string,
  mediaUrl: string,
): Promise<{ buffer: Buffer; contentType: string } | { error: string }> {
  if (!isMp4LikeVideo(contentType, mediaUrl)) {
    return { buffer, contentType };
  }

  const hasAudio = detectMp4Audio(buffer).kind !== 'no_audio';

  try {
    const transcoded = await transcodeForTikTok(buffer, hasAudio);
    return { buffer: transcoded, contentType: 'video/mp4' };
  } catch (error) {
    return {
      error: error instanceof Error ? `Could not transcode video for TikTok upload: ${error.message}` : 'Could not transcode video for TikTok upload',
    };
  }
}

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

type TikTokPublishStatus =
  | 'PROCESSING_UPLOAD'
  | 'PROCESSING_DOWNLOAD'
  | 'SEND_TO_USER_INBOX'
  | 'PUBLISH_COMPLETE'
  | 'FAILED';

function parseTikTokError(data: Record<string, unknown>): string | undefined {
  const err = data.error as Record<string, unknown> | undefined;
  if (!err) return undefined;
  if (err.code === 'ok') return undefined;
  const code = err.code as string | undefined;
  const message = err.message as string | undefined;
  const logId = err.log_id as string | undefined;
  // TikTok's policy errors are intentionally vague; surface the error code and
  // log_id in the returned message so we can diagnose specific failures.
  const parts = [message || 'Unknown TikTok error'];
  if (code && code !== 'ok') parts.push(`code=${code}`);
  if (logId) parts.push(`log_id=${logId}`);
  return parts.join(' | ');
}

type TikTokPublishStatusResult = {
  status?: TikTokPublishStatus | string;
  publiclyAvailablePostId?: string | string[];
  failReason?: string;
  uploadedBytes?: number;
  downloadedBytes?: number;
  error?: string;
};

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

  const data = await res.json();
  const error = parseTikTokError(data);
  if (error) return { error };

  return {
    status: data.data?.status as string | undefined,
    publiclyAvailablePostId: (data.data?.publicaly_available_post_id || data.data?.publicly_available_post_id) as string | string[] | undefined,
    failReason: data.data?.fail_reason as string | undefined,
    uploadedBytes: typeof data.data?.uploaded_bytes === 'number' ? data.data.uploaded_bytes : undefined,
    downloadedBytes: typeof data.data?.downloaded_bytes === 'number' ? data.data.downloaded_bytes : undefined,
  };
}

function buildTikTokMediaProxyUrl(mediaUrl: string, kind: 'image' | 'video'): string {
  const appUrl = process.env.OAUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (!appUrl) {
    throw new Error('Missing app URL for TikTok media proxy');
  }

  const proxyPath = kind === 'video' ? '/api/media/video-proxy' : '/api/media/proxy';
  const proxyUrl = new URL(proxyPath, appUrl);
  proxyUrl.searchParams.set('url', mediaUrl);
  return proxyUrl.toString();
}

async function downloadVideoForTikTokUpload(mediaUrl: string): Promise<{ buffer: Buffer; contentType: string } | { error: string }> {
  try {
    const res = await fetch(mediaUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(TIKTOK_FILE_UPLOAD_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { error: `Could not read video for TikTok upload (HTTP ${res.status})` };
    }

    const contentType = res.headers.get('content-type') || 'video/mp4';
    if (!contentType.startsWith('video/')) {
      return { error: `Video source returned ${contentType || 'no content-type'} instead of video/*` };
    }

    const buffer = await readResponseBufferWithLimit(res, TIKTOK_MAX_VIDEO_BYTES);
    return normalizeVideoForTikTokUpload(buffer, contentType, mediaUrl);
  } catch (error) {
    return {
      error: error instanceof Error ? `Could not read video for TikTok upload: ${error.message}` : 'Could not read video for TikTok upload',
    };
  }
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

async function uploadTikTokVideoBytes(
  uploadUrl: string,
  buffer: Buffer,
  contentType: string,
  chunkSize: number,
  totalChunkCount: number,
): Promise<{ ok: true } | { error: string }> {
  const videoSize = buffer.byteLength;

  for (let index = 0; index < totalChunkCount; index++) {
    const firstByte = index * chunkSize;
    const lastByte = index === totalChunkCount - 1
      ? videoSize - 1
      : Math.min(videoSize - 1, firstByte + chunkSize - 1);
    const chunk = buffer.subarray(firstByte, lastByte + 1);
    const body = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;

    const uploadRes = await fetchWithRetry(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(chunk.byteLength),
        'Content-Range': `bytes ${firstByte}-${lastByte}/${videoSize}`,
      },
      body,
    }, {
      timeoutMs: TIKTOK_FILE_UPLOAD_TIMEOUT_MS,
      maxRetries: 3,
    });

    const expectedStatus = index === totalChunkCount - 1 ? 201 : 206;
    if (uploadRes.status !== expectedStatus) {
      const body = await uploadRes.text().catch(() => '');
      return {
        error: `TikTok file upload failed on chunk ${index + 1}/${totalChunkCount} (HTTP ${uploadRes.status}${body ? `: ${body.slice(0, 240)}` : ''})`,
      };
    }
  }

  return { ok: true };
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
    const reason = res.status === 401 || code === 'access_token_invalid' || code === 'token_expired'
      ? 'auth'
      : code === 'scope_not_authorized' || code === 'scope_permission_missed'
        ? 'unsupported'
        : 'transient';
    return { ok: false, error: error || `TikTok video query failed (HTTP ${res.status})`, reason };
  }

  const video = (data.data?.videos as Array<Record<string, unknown>> | undefined)?.find(
    (v) => String(v.id) === String(videoId),
  );
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
  if (status === 401 || code === 'access_token_invalid' || code === 'token_expired') return 'auth';
  if (code === 'scope_not_authorized' || code === 'scope_permission_missed') return 'unsupported';
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
  const data = await res.json().catch(() => ({}));
  const error = parseTikTokError(data);
  if (error || !res.ok) {
    const code = (data.error?.code as string | undefined) || '';
    return {
      ok: false,
      error: error || `TikTok video list failed (HTTP ${res.status})`,
      reason: classifyTikTokListError(res.status, code),
    };
  }

  const videos = (data.data?.videos as Array<Record<string, unknown>> | undefined) ?? [];
  const posts: PlatformPostSummary[] = videos
    .filter((video) => video.id !== undefined && video.id !== null)
    .map((video) => {
      const createTime = metricNum(video.create_time);
      const description = typeof video.video_description === 'string' && video.video_description
        ? video.video_description
        : typeof video.title === 'string' ? video.title : null;
      return {
        externalId: String(video.id),
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

    try {
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
      // post from the app. Direct Post requires separate platform access.
      // PULL_FROM_URL still requires a verified domain, so Firebase URLs are
      // proxied through our own domain via /api/media/proxy.
      const proxyUrls = imageUrls.map((url) => buildTikTokMediaProxyUrl(url, 'image'));

      const tiktokSettings = asTikTokSettings(request.settings);
      const photoCoverIndex = tiktokSettings?.photoCoverIndex ?? request.photoCoverIndex ?? 0;

      // privacy_level / disable_comment / disable_duet / disable_stitch only
      // take effect with TikTok's Direct Post mode. Markaestro currently
      // publishes photos via MEDIA_UPLOAD (inbox handoff), so these fields
      // are accepted at the API boundary but ignored here until Direct Post
      // is enabled. Log so integrators can see the value made it this far.
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
