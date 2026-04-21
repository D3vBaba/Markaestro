import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken, getMeta } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';
import type { SocialChannel } from '@/lib/schemas';

// YouTube Data API v3 video upload. We use the resumable upload endpoint with
// a single-chunk strategy — the whole video is sent in one PUT after
// initializing the upload session. YouTube enforces a daily 1.6M "quota cost"
// per project; each upload costs 1600 units, so ~1000 uploads/day/project.
// If we hit that ceiling we'll need per-workspace OAuth apps.
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';

const MAX_TITLE_LEN = 100;
const MAX_DESCRIPTION_LEN = 5000;

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/.test(lower) || lower.includes('/videos/');
}

function getChannelId(connection: PlatformConnection): string {
  return getMeta<string>(connection, 'channelId', '');
}

/**
 * YouTube videos need a title + description. We derive the title from the
 * first non-empty line of content (trimmed to 100 chars) and use the full
 * content as description. Hashtags already embedded in content become tags
 * via YouTube's automatic hashtag extraction.
 */
function splitContent(content: string): { title: string; description: string } {
  const firstLine = content.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) || 'Untitled';
  const title = firstLine.length > MAX_TITLE_LEN
    ? firstLine.slice(0, MAX_TITLE_LEN - 1) + '…'
    : firstLine;
  const description = content.length > MAX_DESCRIPTION_LEN
    ? content.slice(0, MAX_DESCRIPTION_LEN - 1) + '…'
    : content;
  return { title, description };
}

async function downloadBinary(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetchWithRetry(url, {}, { maxRetries: 2 });
  if (!res.ok) throw new Error(`Video download failed (${res.status}) for ${url}`);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'video/mp4',
  };
}

async function initUploadSession(
  accessToken: string,
  title: string,
  description: string,
  contentLength: number,
  contentType: string,
): Promise<string> {
  const url = `${YOUTUBE_UPLOAD}/videos?uploadType=resumable&part=snippet,status`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(contentLength),
      'X-Upload-Content-Type': contentType,
    },
    body: JSON.stringify({
      snippet: {
        title,
        description,
        categoryId: '22',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    }),
  }, { maxRetries: 2 });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `YouTube upload init failed (${res.status}): ${err.error?.message || res.statusText}`,
    );
  }
  const uploadUrl = res.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube upload init succeeded but no Location header returned');
  return uploadUrl;
}

async function uploadVideoBinary(
  uploadUrl: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const res = await fetchWithRetry(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
    },
    body: bytes as unknown as BodyInit,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`YouTube upload failed (${res.status}): ${data.error?.message || res.statusText}`);
  }
  return String(data.id);
}

async function publishToYouTube(
  connection: PlatformConnection,
  content: string,
  mediaUrls: string[],
): Promise<PublishResult> {
  if (!getChannelId(connection)) {
    return { success: false, error: 'YouTube channel not selected. Pick a channel from product settings.' };
  }

  const videoUrl = mediaUrls.find(isVideoUrl);
  if (!videoUrl) {
    return { success: false, error: 'YouTube requires a video file.' };
  }

  const accessToken = getAccessToken(connection);
  const { title, description } = splitContent(content);

  try {
    const { bytes, contentType } = await downloadBinary(videoUrl);
    const uploadUrl = await initUploadSession(accessToken, title, description, bytes.byteLength, contentType);
    const videoId = await uploadVideoBinary(uploadUrl, bytes, contentType);
    return {
      success: true,
      externalId: videoId,
      externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown YouTube publishing error' };
  }
}

export const youtubePublishingAdapter: PlatformAdapter = {
  id: 'youtube-publishing',
  name: 'YouTube',
  channels: ['youtube'],
  capabilities: [PlatformCapability.PUBLISH_VIDEO],

  async publish(connection, request: PublishRequest): Promise<PublishResult> {
    return publishToYouTube(connection, request.content, request.mediaUrls ?? []);
  },

  async testConnection(connection) {
    const accessToken = getAccessToken(connection);
    try {
      const url = `${YOUTUBE_API}/channels?${new URLSearchParams({
        part: 'snippet',
        mine: 'true',
      }).toString()}`;
      const res = await fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }, { maxRetries: 1 });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
      const first = Array.isArray(data.items) ? data.items[0] : null;
      const label = first?.snippet?.title
        ? String(first.snippet.title)
        : getMeta<string>(connection, 'channelTitle', 'YouTube');
      return { ok: true, label };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Connection test failed' };
    }
  },

  validateConnection(connection, _channel: SocialChannel): string | null {
    void _channel;
    if (!getChannelId(connection)) {
      return 'YouTube channel not selected. Pick a channel from product settings.';
    }
    return null;
  },
};
