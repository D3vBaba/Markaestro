import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken, getMeta } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';

const X_API_V2 = 'https://api.x.com/2';
const X_UPLOAD_API = 'https://upload.twitter.com/1.1';
const MAX_TWEET_LENGTH = 280;

async function uploadMedia(accessToken: string, mediaUrl: string): Promise<string | null> {
  try {
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

    // APPEND
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

export const xPublishingAdapter: PlatformAdapter = {
  id: 'x-publishing',
  name: 'X (Twitter)',
  channels: ['x'],
  capabilities: [
    PlatformCapability.PUBLISH_TEXT,
    PlatformCapability.PUBLISH_IMAGE,
  ],

  async publish(connection: PlatformConnection, request: PublishRequest): Promise<PublishResult> {
    const accessToken = getAccessToken(connection);
    const username = getMeta(connection, 'username', '');

    if (request.content.length > MAX_TWEET_LENGTH && (!request.mediaUrls || request.mediaUrls.length === 0)) {
      return {
        success: false,
        error: `Tweet exceeds ${MAX_TWEET_LENGTH} character limit (${request.content.length} chars)`,
      };
    }

    const tweetPayload: Record<string, unknown> = { text: request.content };

    if (request.mediaUrls && request.mediaUrls.length > 0) {
      const mediaIds: string[] = [];
      for (const url of request.mediaUrls.slice(0, 4)) {
        const mediaId = await uploadMedia(accessToken, url);
        if (mediaId) mediaIds.push(mediaId);
      }
      if (mediaIds.length > 0) {
        tweetPayload.media = { media_ids: mediaIds };
      }
    }

    const res = await fetchWithRetry(`${X_API_V2}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
      externalUrl: tweetId && username
        ? `https://x.com/${username}/status/${tweetId}`
        : undefined,
    };
  },

  async testConnection(connection: PlatformConnection) {
    const accessToken = getAccessToken(connection);
    const res = await fetchWithRetry(`${X_API_V2}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail || err.title || `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, label: data.data?.username };
  },

  validateConnection(_connection: PlatformConnection, _channel) {
    return null; // X has no special metadata requirements
  },
};
