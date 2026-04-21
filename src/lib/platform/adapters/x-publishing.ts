import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken, getMeta } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';
import type { SocialChannel } from '@/lib/schemas';

// X (Twitter) API v2. We use the v2 media endpoint (POST /2/media/upload) and
// v2 tweets endpoint (POST /2/tweets). The v2 media flow has three phases —
// INIT, APPEND (chunked), FINALIZE — followed by polling /2/media/upload for
// async processing to complete (required for video). For images we wait up to
// a few seconds; for video up to 5 minutes.
const X_API = 'https://api.twitter.com/2';
const X_TWEET_URL = (username: string, id: string) => `https://x.com/${username}/status/${id}`;

const MAX_TWEET_LEN = 280;
const MAX_MEDIA_ITEMS = 4;
const CHUNK_SIZE = 4 * 1024 * 1024;
const MEDIA_POLL_INTERVAL_MS = 2000;
const MEDIA_POLL_MAX_ATTEMPTS = 60;

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/.test(lower) || lower.includes('/videos/');
}

function truncateTweet(text: string): string {
  if (text.length <= MAX_TWEET_LEN) return text;
  return text.slice(0, MAX_TWEET_LEN - 1) + '…';
}

async function downloadBinary(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetchWithRetry(url, {}, { maxRetries: 2 });
  if (!res.ok) throw new Error(`Media download failed (${res.status}) for ${url}`);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

async function mediaInit(
  accessToken: string,
  totalBytes: number,
  mediaType: string,
  mediaCategory: 'tweet_image' | 'tweet_video' | 'tweet_gif',
): Promise<string> {
  const body = new URLSearchParams({
    command: 'INIT',
    total_bytes: String(totalBytes),
    media_type: mediaType,
    media_category: mediaCategory,
  });
  const res = await fetchWithRetry(`${X_API}/media/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  }, { maxRetries: 2 });
  const data = await res.json().catch(() => ({}));
  const mediaId = data?.data?.id || data?.id || data?.media_id_string;
  if (!res.ok || !mediaId) {
    throw new Error(`X media INIT failed (${res.status}): ${data.detail || data.error || res.statusText}`);
  }
  return String(mediaId);
}

async function mediaAppend(
  accessToken: string,
  mediaId: string,
  chunk: Buffer,
  segmentIndex: number,
): Promise<void> {
  const form = new FormData();
  form.append('command', 'APPEND');
  form.append('media_id', mediaId);
  form.append('segment_index', String(segmentIndex));
  form.append(
    'media',
    new Blob([new Uint8Array(chunk)], { type: 'application/octet-stream' }),
    'chunk',
  );
  const res = await fetchWithRetry(`${X_API}/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  }, { maxRetries: 2 });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`X media APPEND failed (${res.status}, segment ${segmentIndex}): ${text || res.statusText}`);
  }
}

async function mediaFinalize(accessToken: string, mediaId: string): Promise<{ processingInfo?: { state?: string; checkAfterSecs?: number } }> {
  const body = new URLSearchParams({ command: 'FINALIZE', media_id: mediaId });
  const res = await fetchWithRetry(`${X_API}/media/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  }, { maxRetries: 2 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`X media FINALIZE failed (${res.status}): ${data.detail || res.statusText}`);
  }
  const info = data?.data?.processing_info || data?.processing_info;
  return {
    processingInfo: info
      ? { state: info.state, checkAfterSecs: info.check_after_secs }
      : undefined,
  };
}

async function waitForMediaProcessing(accessToken: string, mediaId: string): Promise<void> {
  for (let i = 0; i < MEDIA_POLL_MAX_ATTEMPTS; i++) {
    const url = `${X_API}/media/upload?${new URLSearchParams({
      command: 'STATUS',
      media_id: mediaId,
    }).toString()}`;
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, { maxRetries: 1 });
    const data = await res.json().catch(() => ({}));
    const info = data?.data?.processing_info || data?.processing_info;
    if (!info) return;
    const state = String(info.state || '').toLowerCase();
    if (state === 'succeeded') return;
    if (state === 'failed') {
      throw new Error(`X media processing failed: ${info.error?.message || 'unknown error'}`);
    }
    const wait = (info.check_after_secs ? info.check_after_secs * 1000 : MEDIA_POLL_INTERVAL_MS);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error('X media processing timed out');
}

async function uploadMedia(accessToken: string, mediaUrl: string): Promise<string> {
  const { bytes, contentType } = await downloadBinary(mediaUrl);
  const video = isVideoUrl(mediaUrl);
  const category: 'tweet_image' | 'tweet_video' | 'tweet_gif' = video
    ? 'tweet_video'
    : contentType.toLowerCase().includes('gif')
      ? 'tweet_gif'
      : 'tweet_image';

  const mediaId = await mediaInit(accessToken, bytes.byteLength, contentType, category);

  let segmentIndex = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.byteLength));
    await mediaAppend(accessToken, mediaId, chunk, segmentIndex);
    segmentIndex++;
  }

  const { processingInfo } = await mediaFinalize(accessToken, mediaId);
  if (processingInfo && processingInfo.state && processingInfo.state !== 'succeeded') {
    await waitForMediaProcessing(accessToken, mediaId);
  }

  return mediaId;
}

async function createTweet(
  accessToken: string,
  text: string,
  mediaIds: string[],
): Promise<string> {
  const body: Record<string, unknown> = { text };
  if (mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }
  const res = await fetchWithRetry(`${X_API}/tweets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, { maxRetries: 2 });
  const data = await res.json().catch(() => ({}));
  const id = data?.data?.id;
  if (!res.ok || !id) {
    throw new Error(`X tweet create failed (${res.status}): ${data.detail || data.title || res.statusText}`);
  }
  return String(id);
}

async function publishToX(
  connection: PlatformConnection,
  content: string,
  mediaUrls: string[],
): Promise<PublishResult> {
  const accessToken = getAccessToken(connection);
  const username = getMeta<string>(connection, 'username', '');

  try {
    const limited = mediaUrls.slice(0, MAX_MEDIA_ITEMS);
    // X doesn't allow mixing video with images in a single tweet. If a video is
    // present, use only the first video.
    const videos = limited.filter(isVideoUrl);
    const media: string[] = videos.length > 0 ? [videos[0]] : limited;

    const mediaIds = await Promise.all(media.map((url) => uploadMedia(accessToken, url)));
    const tweetId = await createTweet(accessToken, truncateTweet(content), mediaIds);
    return {
      success: true,
      externalId: tweetId,
      externalUrl: X_TWEET_URL(username || 'i', tweetId),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown X publishing error' };
  }
}

export const xPublishingAdapter: PlatformAdapter = {
  id: 'x-publishing',
  name: 'X',
  channels: ['x'],
  capabilities: [
    PlatformCapability.PUBLISH_TEXT,
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_VIDEO,
    PlatformCapability.PUBLISH_CAROUSEL,
  ],

  async publish(connection, request: PublishRequest): Promise<PublishResult> {
    return publishToX(connection, request.content, request.mediaUrls ?? []);
  },

  async testConnection(connection) {
    const accessToken = getAccessToken(connection);
    try {
      const res = await fetchWithRetry(`${X_API}/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }, { maxRetries: 1 });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.detail || data.title || `HTTP ${res.status}` };
      const username = data?.data?.username;
      const label = username
        ? `@${username}`
        : getMeta<string>(connection, 'displayName', 'X');
      return { ok: true, label };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Connection test failed' };
    }
  },

  validateConnection(_connection, _channel: SocialChannel): string | null {
    void _channel;
    return null;
  },
};
