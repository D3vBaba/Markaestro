import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';
const TIKTOK_MAX_SINGLE_UPLOAD_BYTES = 64 * 1024 * 1024;
const TIKTOK_MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const TIKTOK_DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024;

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

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm)(\?|$)/.test(lower) || lower.includes('/videos/');
}

function chooseChunkPlan(size: number): { chunkSize: number; totalChunkCount: number } {
  if (size <= TIKTOK_MAX_SINGLE_UPLOAD_BYTES) {
    return { chunkSize: size, totalChunkCount: 1 };
  }

  let totalChunkCount = Math.ceil(size / TIKTOK_DEFAULT_CHUNK_BYTES);
  let chunkSize = TIKTOK_DEFAULT_CHUNK_BYTES;
  const remainder = size % TIKTOK_DEFAULT_CHUNK_BYTES;

  // Keep the final chunk above TikTok's minimum chunk size when possible.
  if (remainder > 0 && remainder < TIKTOK_MIN_CHUNK_BYTES && totalChunkCount > 1) {
    totalChunkCount -= 1;
    chunkSize = Math.ceil(size / totalChunkCount);
  }

  return { chunkSize, totalChunkCount };
}

type TikTokPublishStatusResult = {
  status?: TikTokPublishStatus | string;
  failReason?: string;
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
    failReason: data.data?.fail_reason as string | undefined,
  };
}

async function uploadVideoFileToTikTok(
  accessToken: string,
  mediaUrl: string,
): Promise<{ publishId?: string; error?: string }> {
  const mediaRes = await fetchWithRetry(mediaUrl);
  if (!mediaRes.ok) {
    return { error: `Could not download media file (${mediaRes.status})` };
  }

  const mediaType = mediaRes.headers.get('content-type') || 'video/mp4';
  const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());
  const { chunkSize, totalChunkCount } = chooseChunkPlan(mediaBuffer.length);

  // Use the inbox endpoint (video.upload scope) so the video lands as a draft
  // in the user's TikTok inbox. Direct video post requires video.publish +
  // audit approval, which this app doesn't have. post_info is not accepted
  // by the inbox endpoint — the user sets title/privacy in the TikTok app.
  const initRes = await fetchWithRetry(`${TIKTOK_API}/post/publish/inbox/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: mediaBuffer.length,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }),
  });

  const initData = await initRes.json();
  const initError = parseTikTokError(initData);
  if (initError) {
    return { error: initError };
  }

  const uploadUrl = initData.data?.upload_url as string | undefined;
  const publishId = initData.data?.publish_id as string | undefined;
  if (!uploadUrl || !publishId) {
    return { error: 'TikTok did not return an upload URL' };
  }

  let start = 0;
  for (let i = 0; i < totalChunkCount; i++) {
    const endExclusive =
      i === totalChunkCount - 1 ? mediaBuffer.length : Math.min(mediaBuffer.length, start + chunkSize);
    const chunk = mediaBuffer.subarray(start, endExclusive);

    const uploadRes = await fetchWithRetry(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mediaType,
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${start}-${endExclusive - 1}/${mediaBuffer.length}`,
      },
      body: chunk,
    });

    if (uploadRes.status !== 201 && uploadRes.status !== 206) {
      return { error: `TikTok upload failed (${uploadRes.status})` };
    }
    start = endExclusive;
  }

  // Inbox uploads rarely terminate within a synchronous poll window — TikTok's
  // transcoding can take minutes to hours. Return immediately; the background
  // fast-poll (`/api/worker/tiktok-poll`) transitions the post to
  // `exported_for_review` or `failed` within ~60s of TikTok reporting terminal.
  return { publishId };
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

    if (!request.mediaUrls?.[0]) {
      return {
        success: false,
        error: 'TikTok requires media content (photo or video). Text-only posts are not supported.',
      };
    }

    const mediaUrl = request.mediaUrls[0];
    const isVideo = isVideoUrl(mediaUrl);

    try {
      if (isVideo) {
        const result = await uploadVideoFileToTikTok(accessToken, mediaUrl);
        if (result.error) {
          return { success: false, error: `TikTok publish failed: ${result.error}` };
        }
        return {
          success: false,
          pending: true,
          externalId: result.publishId || '',
        };
      }

      // Photo carousel path uses MEDIA_UPLOAD (video.upload scope). Content
      // lands in the user's TikTok inbox; they finalize caption/privacy and
      // post from the app. Direct Post requires a separate audit approval.
      // PULL_FROM_URL still requires a verified domain, so Firebase URLs are
      // proxied through our own domain via /api/media/proxy.
      const appUrl = process.env.OAUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
      const imageUrls = (request.mediaUrls || []).filter((u) => !isVideoUrl(u));
      const proxyUrls = imageUrls.map(
        (url) => `${appUrl}/api/media/proxy?url=${encodeURIComponent(url)}`,
      );

      const body: Record<string, unknown> = {
        post_info: {
          title: request.content.substring(0, 90),
          description: request.content.substring(0, 4000),
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: request.photoCoverIndex ?? 0,
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
