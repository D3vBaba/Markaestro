import { fetchWithRetry } from '@/lib/fetch-retry';
import { emptyMetrics, getAccessToken, getMeta, metricNum } from '../base-adapter';
import { PlatformCapability } from '../types';
import type {
  AudienceFetchResult,
  DeletePostInput,
  DeletePostResult,
  ListPostsInput,
  ListPostsResult,
  MetricsFetchInput,
  MetricsFetchResult,
  PlatformAdapter,
  PlatformConnection,
  PlatformPostSummary,
  PublishRequest,
  PublishResult,
} from '../types';
import type { SocialChannel } from '@/lib/schemas';

// Threads uses a Meta-style 2-step publish: create a media container, then call
// threads_publish with the container ID. Containers can take 5-30s to finish
// processing (especially for video), so we poll the status endpoint before publish.
const THREADS_API = 'https://graph.threads.net/v1.0';
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_MAX_ATTEMPTS = 30;
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_POLL_MAX_ATTEMPTS = 60;
// Threads carousels accept up to 20 items. Kept in step with the catalog's
// `maxMediaItems` for threads, which is what validation rejects against first.
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
    return { success: false, error: 'Threads user ID missing. Reconnect Threads from brand settings.' };
  }
  if (mediaUrls.length > MAX_CAROUSEL_ITEMS) {
    return {
      success: false,
      error: `Threads allows a maximum of ${MAX_CAROUSEL_ITEMS} media items per post. This post has ${mediaUrls.length}.`,
    };
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
      const childIds = await Promise.all(mediaUrls.map(async (url) => {
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

// ── Metrics ─────────────────────────────────────────────────────────

/** Complete Threads media-insights metric list (no reach/saves/clicks at post level). */
const THREADS_MEDIA_METRICS = 'views,likes,replies,reposts,quotes,shares';

type ThreadsError = { error?: { code?: number; message?: string } };

function classifyThreadsError(status: number, data: ThreadsError): 'auth' | 'not_found' | 'unsupported' | 'transient' {
  const code = data.error?.code;
  const message = data.error?.message || '';
  if (status === 401 || code === 190) return 'auth';
  if (code === 100 && /does not exist|unsupported get request/i.test(message)) return 'not_found';
  if (code === 10 || code === 200) return 'unsupported';
  return 'transient';
}

async function fetchThreadsMetrics(
  connection: PlatformConnection,
  mediaId: string,
): Promise<MetricsFetchResult> {
  const accessToken = getAccessToken(connection);
  const url = `${THREADS_API}/${mediaId}/insights?${new URLSearchParams({
    metric: THREADS_MEDIA_METRICS,
    access_token: accessToken,
  }).toString()}`;
  const res = await fetchWithRetry(url, {}, { maxRetries: 1 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data.error?.message || `Threads insights failed (HTTP ${res.status})`,
      reason: classifyThreadsError(res.status, data),
    };
  }

  const values: Record<string, number> = {};
  for (const entry of (data.data ?? []) as Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }>) {
    if (!entry.name) continue;
    const value = metricNum(entry.total_value?.value ?? entry.values?.[0]?.value);
    if (value !== null) values[entry.name] = value;
  }
  // Reposting others' content returns an empty insights array — nothing to record.
  if (Object.keys(values).length === 0) {
    return { ok: false, error: 'Threads returned no insights for this post', reason: 'unsupported' };
  }

  const metrics = emptyMetrics();
  metrics.views = metricNum(values.views);
  metrics.impressions = metrics.views;
  metrics.likes = metricNum(values.likes);
  metrics.comments = metricNum(values.replies);
  // `reposts` is the reshare-equivalent; direct `shares` (sends) stay in raw.
  metrics.shares = metricNum(values.reposts);
  metrics.raw = values;
  return { ok: true, metrics };
}

async function fetchThreadsAudience(connection: PlatformConnection): Promise<AudienceFetchResult> {
  const userId = getThreadsUserId(connection);
  if (!userId) return { ok: false, error: 'Threads user ID missing', reason: 'unsupported' };
  const accessToken = getAccessToken(connection);
  const url = `${THREADS_API}/${userId}/threads_insights?${new URLSearchParams({
    metric: 'followers_count',
    access_token: accessToken,
  }).toString()}`;
  const res = await fetchWithRetry(url, {}, { maxRetries: 1 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data.error?.message || `HTTP ${res.status}`,
      reason: classifyThreadsError(res.status, data),
    };
  }
  const entry = (data.data ?? []).find((d: { name?: string }) => d.name === 'followers_count');
  const followers = metricNum(entry?.total_value?.value ?? entry?.values?.[0]?.value);
  if (followers === null) return { ok: false, error: 'followers_count not returned', reason: 'unsupported' };
  return { ok: true, followers };
}

// ── Platform post management (list / delete) ───────────────────────

const DEFAULT_LIST_LIMIT = 24;
const MAX_LIST_LIMIT = 50;
const THREADS_LIST_FIELDS = 'id,text,media_type,media_url,thumbnail_url,permalink,timestamp';

function mapThreadsMediaType(mediaType: string | undefined): PlatformPostSummary['mediaType'] {
  switch (mediaType) {
    case 'TEXT_POST': return 'text';
    case 'IMAGE': return 'image';
    case 'VIDEO': return 'video';
    case 'CAROUSEL_ALBUM': return 'carousel';
    default: return 'unknown';
  }
}

/** Threads delete needs the `threads_delete` permission (granted on reconnect). */
function isThreadsPermissionError(status: number, data: ThreadsError): boolean {
  const code = data.error?.code;
  const message = data.error?.message || '';
  return status === 403 || code === 10 || code === 200 || /permission|scope/i.test(message);
}

async function listThreadsPosts(
  connection: PlatformConnection,
  input: ListPostsInput,
): Promise<ListPostsResult> {
  const userId = getThreadsUserId(connection);
  if (!userId) {
    return { ok: false, error: 'Threads user ID missing. Reconnect Threads from brand settings.', reason: 'unsupported' };
  }
  const accessToken = getAccessToken(connection);
  const limit = Math.min(Math.max(1, Math.floor(input.limit || DEFAULT_LIST_LIMIT)), MAX_LIST_LIMIT);
  const url = `${THREADS_API}/${userId}/threads?${new URLSearchParams({
    fields: THREADS_LIST_FIELDS,
    limit: String(limit),
    access_token: accessToken,
    ...(input.cursor ? { after: input.cursor } : {}),
  }).toString()}`;

  const res = await fetchWithRetry(url, {}, { maxRetries: 1 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = classifyThreadsError(res.status, data);
    return {
      ok: false,
      error: data.error?.message || `Threads posts fetch failed (HTTP ${res.status})`,
      reason: reason === 'not_found' ? 'unsupported' : reason,
    };
  }

  const posts: PlatformPostSummary[] = ((data.data ?? []) as Array<Record<string, unknown>>)
    .filter((post) => typeof post.id === 'string' && post.id)
    .map((post) => ({
      externalId: String(post.id),
      channel: 'threads' as const,
      content: typeof post.text === 'string' ? post.text : null,
      mediaType: mapThreadsMediaType(typeof post.media_type === 'string' ? post.media_type : undefined),
      mediaUrl: typeof post.media_url === 'string' ? post.media_url : null,
      thumbnailUrl: typeof post.thumbnail_url === 'string'
        ? post.thumbnail_url
        : typeof post.media_url === 'string' ? post.media_url : null,
      permalink: typeof post.permalink === 'string' ? post.permalink : null,
      publishedAt: typeof post.timestamp === 'string' ? new Date(post.timestamp).toISOString() : null,
      canDelete: true,
    }));

  // Threads only includes paging.next when another page exists.
  const paging = data.paging as { cursors?: { after?: string }; next?: string } | undefined;
  const nextCursor = paging?.next && paging.cursors?.after ? paging.cursors.after : undefined;
  return { ok: true, posts, nextCursor };
}

async function deleteThreadsPost(
  connection: PlatformConnection,
  mediaId: string,
): Promise<DeletePostResult> {
  const accessToken = getAccessToken(connection);
  const url = `${THREADS_API}/${encodeURIComponent(mediaId)}?${new URLSearchParams({
    access_token: accessToken,
  }).toString()}`;
  const res = await fetchWithRetry(url, { method: 'DELETE' }, { maxRetries: 1 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (isThreadsPermissionError(res.status, data)) {
      return {
        ok: false,
        error: 'Threads delete permission missing. Reconnect Threads to grant the delete permission, then try again.',
        reason: 'unsupported',
      };
    }
    return {
      ok: false,
      error: data.error?.message || `Threads post delete failed (HTTP ${res.status})`,
      reason: classifyThreadsError(res.status, data),
    };
  }
  if (data.success === false) {
    return { ok: false, error: 'Threads did not confirm the deletion', reason: 'transient' };
  }
  return { ok: true };
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

  async fetchMetrics(connection, input: MetricsFetchInput): Promise<MetricsFetchResult> {
    try {
      return await fetchThreadsMetrics(connection, input.externalId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Threads metrics fetch failed', reason: 'transient' };
    }
  },

  async fetchAudience(connection): Promise<AudienceFetchResult> {
    try {
      return await fetchThreadsAudience(connection);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Threads audience fetch failed', reason: 'transient' };
    }
  },

  async listPosts(connection, input: ListPostsInput): Promise<ListPostsResult> {
    try {
      return await listThreadsPosts(connection, input);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Threads posts fetch failed', reason: 'transient' };
    }
  },

  async deletePost(connection, input: DeletePostInput): Promise<DeletePostResult> {
    try {
      return await deleteThreadsPost(connection, input.externalId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Threads post delete failed', reason: 'transient' };
    }
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
      return 'Threads account not linked. Reconnect Threads from brand settings.';
    }
    return null;
  },
};
