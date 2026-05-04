import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import path from 'node:path';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { detectMp4Audio } from '@/lib/media/mp4-audio-detect';
import { readResponseBufferWithLimit } from '@/lib/network-security';
import { isTikTokVideoUrl, validateTikTokMediaUrls } from '@/lib/tiktok-draft-flow';
import { getAccessToken } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';

const TIKTOK_PREFLIGHT_TIMEOUT_MS = 15_000;
const TIKTOK_MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const TIKTOK_FILE_UPLOAD_TIMEOUT_MS = 120_000;
const TIKTOK_MAX_WHOLE_UPLOAD_BYTES = 64 * 1024 * 1024;
const TIKTOK_DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024;

function parseContentRangeTotal(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function parseHeaderByteLength(headers: Headers): number | null {
  const rangeTotal = parseContentRangeTotal(headers.get('content-range'));
  if (rangeTotal) return rangeTotal;

  const contentLength = Number(headers.get('content-length') || '0');
  return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
}

type TikTokVideoPreflight =
  | {
      ok: true;
      sizeBytes: number;
      contentType: string;
      rangeSupported: boolean;
    }
  | { ok: false; error: string };

async function preflightTikTokVideoPullUrl(videoUrl: string): Promise<TikTokVideoPreflight> {
  try {
    const head = await fetch(videoUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIKTOK_PREFLIGHT_TIMEOUT_MS),
    });

    if (head.status >= 300 && head.status < 400) {
      return { ok: false, error: 'TikTok media URL redirects. PULL_FROM_URL requires a final HTTPS URL with no redirects.' };
    }
    if (!head.ok) {
      return { ok: false, error: `TikTok media URL HEAD check failed with HTTP ${head.status}` };
    }

    const contentType = head.headers.get('content-type') || '';
    if (!contentType.startsWith('video/')) {
      return { ok: false, error: `TikTok media URL returned ${contentType || 'no content-type'} instead of video/*` };
    }

    const sizeBytes = parseHeaderByteLength(head.headers);
    if (!sizeBytes) {
      return { ok: false, error: 'TikTok media URL did not expose Content-Length, so TikTok cannot reliably size the pull upload.' };
    }

    const range = await fetch(videoUrl, {
      headers: { Range: 'bytes=0-0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIKTOK_PREFLIGHT_TIMEOUT_MS),
    });

    try {
      if (range.status >= 300 && range.status < 400) {
        return { ok: false, error: 'TikTok media URL range check redirects. PULL_FROM_URL requires no redirects.' };
      }

      // Byte ranges are useful for a fast/resumable pull, but TikTok's
      // PULL_FROM_URL prerequisites only require a stable HTTPS URL that does
      // not redirect and remains accessible. Firebase Hosting can return 200
      // for a Range probe while the same route supports 206 behind the proxy,
      // so do not block a valid full-body response here.
      if (range.status === 206) {
        if (!range.headers.get('content-range')) {
          return { ok: false, error: 'TikTok media URL returned 206 without Content-Range.' };
        }
        return { ok: true, sizeBytes, contentType, rangeSupported: true };
      } else if (range.status === 200) {
        const rangeContentType = range.headers.get('content-type') || '';
        const rangeSizeBytes = parseHeaderByteLength(range.headers);
        if (!rangeContentType.startsWith('video/')) {
          return { ok: false, error: `TikTok media URL range probe returned ${rangeContentType || 'no content-type'} instead of video/*` };
        }
        if (!rangeSizeBytes) {
          return { ok: false, error: 'TikTok media URL range probe did not expose Content-Length.' };
        }
        return { ok: true, sizeBytes, contentType, rangeSupported: false };
      } else {
        return { ok: false, error: `TikTok media URL range probe failed with HTTP ${range.status}` };
      }
    } finally {
      if (range.body) {
        await range.body.cancel();
      }
    }

  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `TikTok media URL preflight failed: ${error.message}` : 'TikTok media URL preflight failed',
    };
  }
}

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

function getFfmpegInstallerPlatform(): string | null {
  const osPlatform = platform();
  const osArch = arch();
  if (osPlatform === 'darwin' && (osArch === 'arm64' || osArch === 'x64')) return `darwin-${osArch}`;
  if (osPlatform === 'linux' && ['arm', 'arm64', 'ia32', 'x64'].includes(osArch)) return `linux-${osArch}`;
  if (osPlatform === 'win32' && (osArch === 'ia32' || osArch === 'x64')) return `win32-${osArch}`;
  return null;
}

function resolveFfmpegBinary(): string | null {
  if (process.env.FFMPEG_BIN && existsSync(process.env.FFMPEG_BIN)) {
    return process.env.FFMPEG_BIN;
  }

  const installerPlatform = getFfmpegInstallerPlatform();
  if (!installerPlatform) return null;

  const binary = platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'node_modules', '@ffmpeg-installer', installerPlatform, binary),
    path.join(/*turbopackIgnore: true*/ process.cwd(), '.next', 'standalone', 'node_modules', '@ffmpeg-installer', installerPlatform, binary),
    path.join(path.dirname(process.execPath), 'node_modules', '@ffmpeg-installer', installerPlatform, binary),
  ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function runFfmpeg(args: string[]): Promise<void> {
  const binary = resolveFfmpegBinary();
  if (!binary) {
    return Promise.reject(new Error('ffmpeg binary is not available'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    const stderr: Buffer[] = [];

    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(Buffer.from(chunk));
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      const message = Buffer.concat(stderr).toString('utf8').slice(-1200);
      reject(new Error(`ffmpeg exited with code ${code}${message ? `: ${message}` : ''}`));
    });
  });
}

async function addSilentAudioTrack(buffer: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markaestro-tiktok-'));
  const inputPath = path.join(dir, 'input.mp4');
  const outputPath = path.join(dir, 'output.mp4');

  try {
    await writeFile(inputPath, buffer);
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-f', 'lavfi',
      '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-shortest',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function normalizeVideoForTikTokUpload(
  buffer: Buffer,
  contentType: string,
  mediaUrl: string,
): Promise<{ buffer: Buffer; contentType: string } | { error: string }> {
  if (!isMp4LikeVideo(contentType, mediaUrl)) {
    return { buffer, contentType };
  }

  const audio = detectMp4Audio(buffer);
  if (audio.kind !== 'no_audio') {
    return { buffer, contentType };
  }

  try {
    const withSilentAudio = await addSilentAudioTrack(buffer);
    return { buffer: withSilentAudio, contentType: 'video/mp4' };
  } catch (error) {
    return {
      error: error instanceof Error ? `Could not add TikTok-compatible silent audio track: ${error.message}` : 'Could not add TikTok-compatible silent audio track',
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
  // Video assets already live on our server-side storage, so expose them on a
  // verified Markaestro URL and let TikTok fetch them directly. This avoids the
  // slower download-into-memory + chunked re-upload flow from our app server.
  const proxyUrl = buildTikTokMediaProxyUrl(mediaUrl, 'video');
  const preflight = await preflightTikTokVideoPullUrl(proxyUrl);
  if (!preflight.ok) {
    return { error: preflight.error };
  }
  if (!preflight.rangeSupported) {
    return uploadVideoFileToTikTokInbox(accessToken, mediaUrl);
  }

  const initRes = await fetchWithRetry(`${TIKTOK_API}/post/publish/inbox/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: proxyUrl,
      },
    }),
  });

  const initData = await initRes.json();
  const initError = parseTikTokError(initData);
  if (initError) {
    return { error: initError };
  }

  const publishId = initData.data?.publish_id as string | undefined;
  if (!publishId) {
    return { error: 'TikTok did not return a publish ID' };
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
      // post from the app. Direct Post requires a separate audit approval.
      // PULL_FROM_URL still requires a verified domain, so Firebase URLs are
      // proxied through our own domain via /api/media/proxy.
      const proxyUrls = imageUrls.map((url) => buildTikTokMediaProxyUrl(url, 'image'));

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
