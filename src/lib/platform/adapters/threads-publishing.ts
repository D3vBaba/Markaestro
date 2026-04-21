import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken, getMeta } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';
import type { SocialChannel } from '@/lib/schemas';

// Threads uses a Meta-style 2-step publish: create a media container, then call
// threads_publish with the container ID. Containers can take 5-30s to finish
// processing (especially for video), so we poll the status endpoint before publish.
const THREADS_API = 'https://graph.threads.net/v1.0';
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_MAX_ATTEMPTS = 30;
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_POLL_MAX_ATTEMPTS = 60;
const MAX_CAROUSEL_ITEMS = 20;

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/.test(lower) || lower.includes('/videos/');
}

function getThreadsUserId(connection: PlatformConnection): string {
  return getMeta(connection, 'threadsUserId', '');
}

function buildPermalinkFallback(userId: string, mediaId: string): string {
  return `https://www.threads.net/@${userId}/post/${mediaId}`;
}

async function createContainer(
  accessToken: string,
  userId: string,
  params: Record<string, string>,
): Promise<string> {
  const url = `${THREADS_API}/${userId}/threads`;
  const body = new URLSearchParams({ access_token: accessToken, ...params });
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, { maxRetries: 2 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`Threads container create failed (${res.status}): ${data.error?.message || data.error_message || res.statusText}`);
  }
  return String(data.id);
}

async function waitForContainer(
  accessToken: string,
  containerId: string,
  opts: { intervalMs: number; maxAttempts: number },
): Promise<void> {
  const url = `${THREADS_API}/${containerId}?${new URLSearchParams({
    fields: 'status,error_message',
    access_token: accessToken,
  }).toString()}`;
  for (let i = 0; i < opts.maxAttempts; i++) {
    const res = await fetchWithRetry(url, {}, { maxRetries: 1 });
    const data = await res.json().catch(() => ({}));
    const status = String(data.status || '').toUpperCase();
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Threads container ${status}: ${data.error_message || 'processing failed'}`);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  throw new Error('Threads container processing timed out');
}

async function publishContainer(
  accessToken: string,
  userId: string,
  containerId: string,
): Promise<string> {
  const url = `${THREADS_API}/${userId}/threads_publish`;
  const body = new URLSearchParams({ access_token: accessToken, creation_id: containerId });
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, { maxRetries: 2 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`Threads publish failed (${res.status}): ${data.error?.message || res.statusText}`);
  }
  return String(data.id);
}

async function getPermalink(accessToken: string, mediaId: string): Promise<string | undefined> {
  try {
    const url = `${THREADS_API}/${mediaId}?${new URLSearchParams({
      fields: 'permalink',
      access_token: accessToken,
    }).toString()}`;
    const res = await fetchWithRetry(url, {}, { maxRetries: 1 });
    const data = await res.json().catch(() => ({}));
    return typeof data.permalink === 'string' ? data.permalink : undefined;
  } catch {
    return undefined;
  }
}

async function publishToThreads(
  connection: PlatformConnection,
  content: string,
  mediaUrls: string[],
): Promise<PublishResult> {
  const userId = getThreadsUserId(connection);
  if (!userId) {
    return { success: false, error: 'Threads user ID missing. Reconnect Threads from product settings.' };
  }
  const accessToken = getAccessToken(connection);

  try {
    let containerId: string;

    if (mediaUrls.length === 0) {
      // Text-only post
      containerId = await createContainer(accessToken, userId, {
        media_type: 'TEXT',
        text: content,
      });
    } else if (mediaUrls.length === 1) {
      const url = mediaUrls[0];
      const video = isVideoUrl(url);
      containerId = await createContainer(accessToken, userId, {
        media_type: video ? 'VIDEO' : 'IMAGE',
        ...(video ? { video_url: url } : { image_url: url }),
        text: content,
      });
      await waitForContainer(accessToken, containerId, {
        intervalMs: video ? VIDEO_POLL_INTERVAL_MS : CONTAINER_POLL_INTERVAL_MS,
        maxAttempts: video ? VIDEO_POLL_MAX_ATTEMPTS : CONTAINER_POLL_MAX_ATTEMPTS,
      });
    } else {
      // Carousel: create item containers first, then wrap in a CAROUSEL container.
      const limited = mediaUrls.slice(0, MAX_CAROUSEL_ITEMS);
      const childIds = await Promise.all(limited.map(async (url) => {
        const video = isVideoUrl(url);
        const id = await createContainer(accessToken, userId, {
          media_type: video ? 'VIDEO' : 'IMAGE',
          ...(video ? { video_url: url } : { image_url: url }),
          is_carousel_item: 'true',
        });
        await waitForContainer(accessToken, id, {
          intervalMs: video ? VIDEO_POLL_INTERVAL_MS : CONTAINER_POLL_INTERVAL_MS,
          maxAttempts: video ? VIDEO_POLL_MAX_ATTEMPTS : CONTAINER_POLL_MAX_ATTEMPTS,
        });
        return id;
      }));
      containerId = await createContainer(accessToken, userId, {
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        text: content,
      });
      await waitForContainer(accessToken, containerId, {
        intervalMs: CONTAINER_POLL_INTERVAL_MS,
        maxAttempts: CONTAINER_POLL_MAX_ATTEMPTS,
      });
    }

    const mediaId = await publishContainer(accessToken, userId, containerId);
    const username = getMeta<string>(connection, 'username', '');
    const permalink = await getPermalink(accessToken, mediaId);
    return {
      success: true,
      externalId: mediaId,
      externalUrl: permalink || buildPermalinkFallback(username || userId, mediaId),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown Threads publishing error',
    };
  }
}

export const threadsPublishingAdapter: PlatformAdapter = {
  id: 'threads-publishing',
  name: 'Threads',
  channels: ['threads'],
  capabilities: [
    PlatformCapability.PUBLISH_TEXT,
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_VIDEO,
    PlatformCapability.PUBLISH_CAROUSEL,
  ],

  async publish(connection, request: PublishRequest): Promise<PublishResult> {
    return publishToThreads(connection, request.content, request.mediaUrls ?? []);
  },

  async testConnection(connection) {
    const accessToken = getAccessToken(connection);
    try {
      const url = `${THREADS_API}/me?${new URLSearchParams({
        fields: 'id,username',
        access_token: accessToken,
      }).toString()}`;
      const res = await fetchWithRetry(url, {}, { maxRetries: 1 });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
      }
      const label = typeof data.username === 'string' && data.username
        ? `@${data.username}`
        : getMeta<string>(connection, 'displayName', 'Threads');
      return { ok: true, label };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Connection test failed' };
    }
  },

  validateConnection(connection, _channel: SocialChannel): string | null {
    void _channel;
    if (!getThreadsUserId(connection)) {
      return 'Threads account not linked. Reconnect Threads from product settings.';
    }
    return null;
  },
};
