import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';
const TIKTOK_MAX_SINGLE_UPLOAD_BYTES = 64 * 1024 * 1024;
const TIKTOK_MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const TIKTOK_DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024;
const TIKTOK_PUBLISH_POLL_ATTEMPTS = 8;
const TIKTOK_PUBLISH_POLL_DELAY_MS = 1500;

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
  return (err.message as string) || (err.code as string) || 'Unknown TikTok error';
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForTikTokPublishResult(
  accessToken: string,
  publishId: string,
): Promise<{ success: boolean; pending?: boolean; error?: string }> {
  for (let attempt = 0; attempt < TIKTOK_PUBLISH_POLL_ATTEMPTS; attempt++) {
    const statusResult = await fetchTikTokPublishStatus(accessToken, publishId);
    if (statusResult.error) {
      return { success: false, error: statusResult.error };
    }

    if (statusResult.status === 'PUBLISH_COMPLETE') {
      return { success: true };
    }

    if (statusResult.status === 'FAILED') {
      return {
        success: false,
        error: statusResult.failReason || 'TikTok did not complete the publish',
      };
    }

    if (attempt < TIKTOK_PUBLISH_POLL_ATTEMPTS - 1) {
      await sleep(TIKTOK_PUBLISH_POLL_DELAY_MS);
    }
  }

  return { success: false, pending: true };
}

async function uploadVideoFileToTikTok(
  accessToken: string,
  mediaUrl: string,
  title: string,
): Promise<{ publishId?: string; pending?: boolean; error?: string }> {
  const mediaRes = await fetchWithRetry(mediaUrl);
  if (!mediaRes.ok) {
    return { error: `Could not download media file (${mediaRes.status})` };
  }

  const mediaType = mediaRes.headers.get('content-type') || 'video/mp4';
  const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());
  const { chunkSize, totalChunkCount } = chooseChunkPlan(mediaBuffer.length);

  const initRes = await fetchWithRetry(`${TIKTOK_API}/post/publish/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title,
        privacy_level: 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
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

  const publishResult = await waitForTikTokPublishResult(accessToken, publishId);
  if (publishResult.error) {
    return { error: publishResult.error };
  }

  if (publishResult.pending) {
    return { publishId, pending: true };
  }

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
        const result = await uploadVideoFileToTikTok(
          accessToken,
          mediaUrl,
          request.content.substring(0, 90),
        );
        if (result.error) {
          return { success: false, error: `TikTok publish failed: ${result.error}` };
        }
        return {
          success: !result.pending,
          pending: result.pending,
          externalId: result.publishId || '',
        };
      }

      // TikTok photo posts only support PULL_FROM_URL (not FILE_UPLOAD).
      // The URL must be on a verified domain, so we proxy Firebase Storage
      // URLs through our own domain via /api/media/proxy.
      const appUrl = process.env.OAUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
      const proxyUrl = `${appUrl}/api/media/proxy?url=${encodeURIComponent(mediaUrl)}`;

      const body: Record<string, unknown> = {
        post_info: {
          title: request.content.substring(0, 90),
          description: request.content.substring(0, 4000),
          disable_comment: false,
          privacy_level: 'SELF_ONLY',
          auto_add_music: true,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: [proxyUrl],
        },
        post_mode: 'DIRECT_POST',
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

      const publishResult = await waitForTikTokPublishResult(accessToken, publishId);
      if (publishResult.error) {
        return { success: false, error: `TikTok publish failed: ${publishResult.error}` };
      }

      return {
        success: !publishResult.pending,
        pending: publishResult.pending,
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
        `${TIKTOK_API}/user/info/?fields=follower_count,video_count`,
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
