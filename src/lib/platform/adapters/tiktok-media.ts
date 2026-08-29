import { fetchWithRetry } from '@/lib/fetch-retry';
import { detectMp4Audio } from '@/lib/media/mp4-audio-detect';
import { transcodeForTikTok } from '@/lib/media/tiktok-transcode';
import { readResponseBufferWithLimit } from '@/lib/network-security';
import { mintMediaProxyToken } from '@/lib/media/proxy-tokens';

/**
 * Low-level TikTok primitives shared by both publishing flows:
 * the inbox hand-off (`tiktok-publishing.ts`) and Direct Post
 * (`tiktok-direct-post.ts`). Kept provider-agnostic — nothing here knows
 * which flow is calling it, so adding Direct Post could not change inbox
 * behavior.
 */

export const TIKTOK_API = 'https://open.tiktokapis.com/v2';

export const TIKTOK_MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const TIKTOK_FILE_UPLOAD_TIMEOUT_MS = 120_000;
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

export function parseTikTokError(data: Record<string, unknown>): string | undefined {
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

export async function downloadVideoForTikTokUpload(
  mediaUrl: string,
): Promise<{ buffer: Buffer; contentType: string } | { error: string }> {
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

export async function uploadTikTokVideoBytes(
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

export function buildTikTokMediaProxyUrl(mediaUrl: string, kind: 'image' | 'video'): string {
  const appUrl = process.env.OAUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (!appUrl) {
    throw new Error('Missing app URL for TikTok media proxy');
  }

  if (kind === 'image') {
    // TikTok's photo puller failed against the query-parameter proxy shape
    // (`photo_pull_failed`) even though the route served a valid JPEG to every
    // client we tested. Its fetcher is known to normalize nested URLs in query
    // strings and to expect an image extension on the path, so images go
    // through the opaque, extension-terminated route instead.
    // Deliberately left unsigned. The signed-token rollout in
    // lib/media/proxy-tokens.ts covers the query-parameter proxies, where an
    // extra parameter is inert. Adding a signature here would change the one
    // path shape TikTok's photo puller is known to accept, so it stays as it
    // is until the change can be verified against the puller directly.
    const token = Buffer.from(mediaUrl, 'utf8').toString('base64url');
    return new URL(`/api/media/tiktok/${token}.jpg`, appUrl).toString();
  }

  const proxyUrl = new URL('/api/media/video-proxy', appUrl);
  proxyUrl.searchParams.set('url', mediaUrl);
  const signature = mintMediaProxyToken(mediaUrl, 'video');
  if (signature) proxyUrl.searchParams.set('t', signature);
  return proxyUrl.toString();
}
