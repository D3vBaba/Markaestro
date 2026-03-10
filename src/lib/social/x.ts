import type { XConfig, PublishResult } from './types';
import { fetchWithRetry } from '@/lib/fetch-retry';

const X_API_V2 = 'https://api.x.com/2';
const X_UPLOAD_API = 'https://upload.twitter.com/1.1';
const MAX_TWEET_LENGTH = 280;

/**
 * Upload media to X via the v1.1 chunked media upload endpoint.
 * Returns the media_id_string to attach to a tweet.
 */
async function uploadMedia(accessToken: string, mediaUrl: string): Promise<string | null> {
  try {
    // Download the media file
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) return null;

    const buffer = Buffer.from(await mediaRes.arrayBuffer());
    const contentType = mediaRes.headers.get('content-type') || 'image/jpeg';

    // INIT
    const initRes = await fetch(`${X_UPLOAD_API}/media/upload.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        command: 'INIT',
        total_bytes: buffer.length.toString(),
        media_type: contentType,
      }).toString(),
    });
    if (!initRes.ok) return null;
    const initData = await initRes.json();
    const mediaId = initData.media_id_string;

    // APPEND (single chunk for images under 5MB)
    const formData = new FormData();
    formData.append('command', 'APPEND');
    formData.append('media_id', mediaId);
    formData.append('segment_index', '0');
    formData.append('media_data', buffer.toString('base64'));

    const appendRes = await fetch(`${X_UPLOAD_API}/media/upload.json`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
    if (!appendRes.ok) return null;

    // FINALIZE
    const finalRes = await fetch(`${X_UPLOAD_API}/media/upload.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        command: 'FINALIZE',
        media_id: mediaId,
      }).toString(),
    });
    if (!finalRes.ok) return null;

    return mediaId;
  } catch {
    return null;
  }
}

export async function publishToX(
  config: XConfig,
  content: string,
  mediaUrls?: string[],
): Promise<PublishResult> {
  if (content.length > MAX_TWEET_LENGTH && (!mediaUrls || mediaUrls.length === 0)) {
    return {
      success: false,
      error: `Tweet exceeds ${MAX_TWEET_LENGTH} character limit (${content.length} chars)`,
    };
  }

  const tweetPayload: Record<string, unknown> = { text: content };

  // Upload media if provided
  if (mediaUrls && mediaUrls.length > 0) {
    const mediaIds: string[] = [];
    for (const url of mediaUrls.slice(0, 4)) { // X allows max 4 images
      const mediaId = await uploadMedia(config.accessToken, url);
      if (mediaId) mediaIds.push(mediaId);
    }
    if (mediaIds.length > 0) {
      tweetPayload.media = { media_ids: mediaIds };
    }
  }

  const res = await fetchWithRetry(`${X_API_V2}/tweets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tweetPayload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail || err.title || `HTTP ${res.status}`;
    return { success: false, error: `X API error: ${detail}` };
  }

  const data = await res.json();
  const tweetId = data.data?.id;

  return {
    success: true,
    externalId: tweetId,
    externalUrl: tweetId && config.username
      ? `https://x.com/${config.username}/status/${tweetId}`
      : undefined,
  };
}

export async function testXConnection(
  config: XConfig,
): Promise<{ ok: boolean; username?: string; error?: string }> {
  const res = await fetchWithRetry(`${X_API_V2}/users/me`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.detail || err.title || `HTTP ${res.status}` };
  }

  const data = await res.json();
  return { ok: true, username: data.data?.username };
}
