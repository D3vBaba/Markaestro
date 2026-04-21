import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken, getMeta } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';
import type { SocialChannel } from '@/lib/schemas';

// Pinterest API v5. Pins must be attached to a board — the board is selected
// post-OAuth via /api/oauth/pages/pinterest/select and stored on the connection.
// Videos need a separate upload flow; v5 accepts a direct media URL for images
// and supports video via media registration (`POST /v5/media`) followed by
// polling until `status === succeeded`.
const PINTEREST_API = 'https://api.pinterest.com/v5';
const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_POLL_MAX_ATTEMPTS = 60;

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/.test(lower) || lower.includes('/videos/');
}

function getBoardId(connection: PlatformConnection): string {
  return getMeta<string>(connection, 'boardId', '');
}

async function downloadBinary(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetchWithRetry(url, {}, { maxRetries: 2 });
  if (!res.ok) throw new Error(`Media download failed (${res.status}) for ${url}`);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

async function registerVideoUpload(accessToken: string): Promise<{ mediaId: string; uploadUrl: string; uploadParams: Record<string, string> }> {
  const res = await fetchWithRetry(`${PINTEREST_API}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ media_type: 'video' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.media_id || !data.upload_url) {
    throw new Error(`Pinterest video register failed (${res.status}): ${data.message || res.statusText}`);
  }
  return {
    mediaId: String(data.media_id),
    uploadUrl: String(data.upload_url),
    uploadParams: (data.upload_parameters || {}) as Record<string, string>,
  };
}

async function uploadVideoBinary(uploadUrl: string, params: Record<string, string>, bytes: Buffer, contentType: string): Promise<void> {
  // Pinterest returns AWS-style multipart form params that must be sent alongside the
  // file in a multipart/form-data POST to the provided upload_url. The `file` field
  // must be the last field in the form per AWS S3 requirements.
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.append(key, value);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), 'upload.mp4');
  const res = await fetchWithRetry(uploadUrl, { method: 'POST', body: form });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pinterest video upload failed (${res.status}): ${text || res.statusText}`);
  }
}

async function waitForVideoReady(accessToken: string, mediaId: string): Promise<void> {
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    const res = await fetchWithRetry(`${PINTEREST_API}/media/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, { maxRetries: 1 });
    const data = await res.json().catch(() => ({}));
    const status = String(data.status || '').toLowerCase();
    if (status === 'succeeded') return;
    if (status === 'failed') throw new Error('Pinterest video processing failed');
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
  }
  throw new Error('Pinterest video processing timed out');
}

type PinMediaSource =
  | { source_type: 'image_url'; url: string }
  | { source_type: 'video_id'; cover_image_url: string; media_id: string }
  | {
      source_type: 'multiple_image_urls';
      items: Array<{ url: string; title?: string; description?: string; link?: string }>;
    };

async function createPin(
  accessToken: string,
  boardId: string,
  description: string,
  mediaSource: PinMediaSource,
): Promise<{ pinId: string; url: string }> {
  const res = await fetchWithRetry(`${PINTEREST_API}/pins`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      board_id: boardId,
      description,
      media_source: mediaSource,
    }),
  }, { maxRetries: 2 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`Pinterest pin create failed (${res.status}): ${data.message || res.statusText}`);
  }
  return {
    pinId: String(data.id),
    url: `https://www.pinterest.com/pin/${data.id}/`,
  };
}

async function publishToPinterest(
  connection: PlatformConnection,
  content: string,
  mediaUrls: string[],
): Promise<PublishResult> {
  const boardId = getBoardId(connection);
  if (!boardId) {
    return { success: false, error: 'Pinterest board not selected. Pick a board from product settings.' };
  }
  if (mediaUrls.length === 0) {
    return { success: false, error: 'Pinterest requires at least one image or video.' };
  }

  const accessToken = getAccessToken(connection);
  try {
    const first = mediaUrls[0];
    let mediaSource: PinMediaSource;

    if (isVideoUrl(first)) {
      const { mediaId, uploadUrl, uploadParams } = await registerVideoUpload(accessToken);
      const { bytes, contentType } = await downloadBinary(first);
      await uploadVideoBinary(uploadUrl, uploadParams, bytes, contentType);
      await waitForVideoReady(accessToken, mediaId);
      // Video pins need a separate cover image — fall back to the first non-video URL
      // if one exists, otherwise use the video URL itself (Pinterest will pull a frame).
      const coverUrl = mediaUrls.slice(1).find((u) => !isVideoUrl(u)) || first;
      mediaSource = { source_type: 'video_id', cover_image_url: coverUrl, media_id: mediaId };
    } else if (mediaUrls.length === 1) {
      mediaSource = { source_type: 'image_url', url: first };
    } else {
      const limited = mediaUrls.slice(0, 5).filter((u) => !isVideoUrl(u));
      mediaSource = {
        source_type: 'multiple_image_urls',
        items: limited.map((url) => ({ url })),
      };
    }

    const pin = await createPin(accessToken, boardId, content, mediaSource);
    return { success: true, externalId: pin.pinId, externalUrl: pin.url };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown Pinterest publishing error' };
  }
}

export const pinterestPublishingAdapter: PlatformAdapter = {
  id: 'pinterest-publishing',
  name: 'Pinterest',
  channels: ['pinterest'],
  capabilities: [
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_VIDEO,
  ],

  async publish(connection, request: PublishRequest): Promise<PublishResult> {
    return publishToPinterest(connection, request.content, request.mediaUrls ?? []);
  },

  async testConnection(connection) {
    const accessToken = getAccessToken(connection);
    try {
      const res = await fetchWithRetry(`${PINTEREST_API}/user_account`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }, { maxRetries: 1 });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.message || `HTTP ${res.status}` };
      const label = typeof data.username === 'string' && data.username
        ? `@${data.username}`
        : getMeta<string>(connection, 'displayName', 'Pinterest');
      return { ok: true, label };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Connection test failed' };
    }
  },

  validateConnection(connection, _channel: SocialChannel): string | null {
    void _channel;
    if (!getBoardId(connection)) {
      return 'Pinterest board not selected. Pick a board from product settings.';
    }
    return null;
  },
};
