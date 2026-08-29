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
import { getPinterestApiEnvironment, getPinterestApiUrl, isPinterestSandbox } from '@/lib/pinterest-api';

// Pinterest API v5. Pins must be attached to a board — the board is selected
// post-OAuth via /api/oauth/pages/pinterest/select and stored on the connection.
// Videos need a separate upload flow; v5 accepts a direct media URL for images
// and supports video via media registration (`POST /v5/media`) followed by
// polling until `status === succeeded`.
const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_POLL_MAX_ATTEMPTS = 60;
// Matches the pinterest entry's `maxMediaItems` in the channel catalog, which
// is what validation rejects against before a publish ever reaches here.
const MAX_PIN_IMAGES = 5;

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
  const res = await fetchWithRetry(getPinterestApiUrl('/media'), {
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
    const res = await fetchWithRetry(getPinterestApiUrl(`/media/${encodeURIComponent(mediaId)}`), {
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
  const res = await fetchWithRetry(getPinterestApiUrl('/pins'), {
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
    const message = String(data.message || res.statusText);
    // Pinterest reports a mixed-ratio carousel as a bare 400 naming neither the
    // offending image nor the fix. Say what to do instead of echoing it.
    if (/same width\/height ratio/i.test(message)) {
      throw new Error(
        'Pinterest needs every image in a Pin to have the same width/height ratio. Re-crop the images to a single shape, then publish again.',
      );
    }
    throw new Error(`Pinterest pin create failed (${res.status}): ${message}`);
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
    return { success: false, error: 'Pinterest board not selected. Pick a board from brand settings.' };
  }
  if (mediaUrls.length === 0) {
    return { success: false, error: 'Pinterest requires at least one image or video.' };
  }
  if (mediaUrls.some(isVideoUrl) && mediaUrls.length > 1) {
    return { success: false, error: 'Pinterest video pins must use a single video without additional images.' };
  }
  if (mediaUrls.some(isVideoUrl) && isPinterestSandbox()) {
    return {
      success: false,
      error: 'Pinterest Sandbox does not support video Pins. Use an image Pin for the Trial-access demo.',
    };
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
      // A mixed image/video set would otherwise drop the videos without a
      // word, and anything past MAX_PIN_IMAGES would vanish the same way.
      const videoUrls = mediaUrls.filter(isVideoUrl);
      if (videoUrls.length > 0) {
        return {
          success: false,
          error: 'Pinterest video pins must be a single video. Remove the other media items and publish again.',
        };
      }
      if (mediaUrls.length > MAX_PIN_IMAGES) {
        return {
          success: false,
          error: `Pinterest allows a maximum of ${MAX_PIN_IMAGES} images per pin. This pin has ${mediaUrls.length}.`,
        };
      }
      mediaSource = {
        source_type: 'multiple_image_urls',
        items: mediaUrls.map((url) => ({ url })),
      };
    }

    const pin = await createPin(accessToken, boardId, content, mediaSource);
    return { success: true, externalId: pin.pinId, externalUrl: pin.url };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown Pinterest publishing error' };
  }
}

// ── Metrics ─────────────────────────────────────────────────────────

/** Pin analytics only reach back 90 days; clamp the query window accordingly. */
const PINTEREST_ANALYTICS_MAX_DAYS = 89;
const PIN_METRIC_TYPES = 'IMPRESSION,PIN_CLICK,OUTBOUND_CLICK,SAVE,TOTAL_COMMENTS,TOTAL_REACTIONS';

function classifyPinterestStatus(status: number): 'auth' | 'not_found' | 'unsupported' | 'transient' {
  if (status === 401) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 403) return 'unsupported';
  return 'transient';
}

function pinterestDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchPinterestMetrics(
  connection: PlatformConnection,
  pinId: string,
  publishedAt?: string,
): Promise<MetricsFetchResult> {
  const accessToken = getAccessToken(connection);
  const now = new Date();
  const earliest = new Date(now.getTime() - PINTEREST_ANALYTICS_MAX_DAYS * 24 * 3600 * 1000);
  const published = publishedAt ? new Date(publishedAt) : earliest;
  const start = published > earliest ? published : earliest;

  const params = new URLSearchParams({
    start_date: pinterestDate(start),
    end_date: pinterestDate(now),
    metric_types: PIN_METRIC_TYPES,
    app_types: 'ALL',
  });
  const res = await fetchWithRetry(
    `${getPinterestApiUrl(`/pins/${encodeURIComponent(pinId)}/analytics`)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data.message || `Pinterest pin analytics failed (HTTP ${res.status})`,
      reason: classifyPinterestStatus(res.status),
    };
  }

  // Period totals live in summary_metrics; lifetime_metrics only carries
  // TOTAL_COMMENTS / TOTAL_REACTIONS. Merge both (lifetime wins where present).
  const summary = (data.all?.summary_metrics ?? {}) as Record<string, unknown>;
  const lifetime = (data.all?.lifetime_metrics ?? {}) as Record<string, unknown>;
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries({ ...summary, ...lifetime })) {
    const num = metricNum(value);
    if (num !== null) values[key] = num;
  }

  const metrics = emptyMetrics();
  metrics.views = metricNum(values.IMPRESSION);
  metrics.impressions = metrics.views;
  metrics.saves = metricNum(values.SAVE);
  metrics.clicks = metricNum(values.OUTBOUND_CLICK);
  metrics.comments = metricNum(values.TOTAL_COMMENTS);
  metrics.likes = metricNum(values.TOTAL_REACTIONS);
  metrics.raw = values;
  return { ok: true, metrics };
}

async function fetchPinterestAudience(connection: PlatformConnection): Promise<AudienceFetchResult> {
  const accessToken = getAccessToken(connection);
  const res = await fetchWithRetry(getPinterestApiUrl('/user_account'), {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, { maxRetries: 1 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data.message || `HTTP ${res.status}`,
      reason: classifyPinterestStatus(res.status),
    };
  }
  const followers = metricNum(data.follower_count);
  if (followers === null) return { ok: false, error: 'follower_count not returned', reason: 'unsupported' };
  const monthlyViews = metricNum(data.monthly_views);
  return { ok: true, followers, raw: monthlyViews !== null ? { monthly_views: monthlyViews } : undefined };
}

// ── Platform post management (list / delete) ───────────────────────

const DEFAULT_LIST_LIMIT = 24;
/** Pinterest page_size ceiling. */
const MAX_LIST_LIMIT = 100;

function mapPinterestMediaType(mediaType: string | undefined): PlatformPostSummary['mediaType'] {
  switch (mediaType) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'multiple_images': case 'multiple_videos': case 'multiple_mixed': return 'carousel';
    default: return 'unknown';
  }
}

function pinThumbnail(media: Record<string, unknown> | undefined): string | null {
  const images = media?.images as Record<string, { url?: string }> | undefined;
  if (!images) return null;
  const preferred = images['600x'] || images['400x300'] || images['orig'];
  if (preferred?.url) return preferred.url;
  for (const size of Object.values(images)) {
    if (size?.url) return size.url;
  }
  return null;
}

async function listPinterestPins(
  connection: PlatformConnection,
  input: ListPostsInput,
): Promise<ListPostsResult> {
  const accessToken = getAccessToken(connection);
  const pageSize = Math.min(Math.max(1, Math.floor(input.limit || DEFAULT_LIST_LIMIT)), MAX_LIST_LIMIT);
  const params = new URLSearchParams({
    page_size: String(pageSize),
    ...(input.cursor ? { bookmark: input.cursor } : {}),
  });
  const res = await fetchWithRetry(`${getPinterestApiUrl('/pins')}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, { maxRetries: 1 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = classifyPinterestStatus(res.status);
    return {
      ok: false,
      error: data.message || `Pinterest pins fetch failed (HTTP ${res.status})`,
      reason: reason === 'not_found' ? 'unsupported' : reason,
    };
  }

  const posts: PlatformPostSummary[] = ((data.items ?? []) as Array<Record<string, unknown>>)
    .filter((pin) => typeof pin.id === 'string' && pin.id)
    .map((pin) => {
      const media = pin.media as Record<string, unknown> | undefined;
      const description = typeof pin.description === 'string' && pin.description
        ? pin.description
        : typeof pin.title === 'string' ? pin.title : null;
      return {
        externalId: String(pin.id),
        channel: 'pinterest' as const,
        content: description,
        mediaType: mapPinterestMediaType(typeof media?.media_type === 'string' ? media.media_type : undefined),
        mediaUrl: pinThumbnail(media),
        thumbnailUrl: pinThumbnail(media),
        permalink: `https://www.pinterest.com/pin/${pin.id}/`,
        publishedAt: typeof pin.created_at === 'string' ? new Date(pin.created_at).toISOString() : null,
        canDelete: true,
      };
    });

  const bookmark = typeof data.bookmark === 'string' && data.bookmark ? data.bookmark : undefined;
  return { ok: true, posts, nextCursor: bookmark };
}

async function deletePinterestPin(
  connection: PlatformConnection,
  pinId: string,
): Promise<DeletePostResult> {
  const accessToken = getAccessToken(connection);
  const res = await fetchWithRetry(getPinterestApiUrl(`/pins/${encodeURIComponent(pinId)}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }, { maxRetries: 1 });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: data.message || `Pinterest pin delete failed (HTTP ${res.status})`,
      reason: classifyPinterestStatus(res.status),
    };
  }
  return { ok: true };
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

  async fetchMetrics(connection, input: MetricsFetchInput): Promise<MetricsFetchResult> {
    try {
      return await fetchPinterestMetrics(connection, input.externalId, input.publishedAt);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Pinterest metrics fetch failed', reason: 'transient' };
    }
  },

  async fetchAudience(connection): Promise<AudienceFetchResult> {
    try {
      return await fetchPinterestAudience(connection);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Pinterest audience fetch failed', reason: 'transient' };
    }
  },

  async listPosts(connection, input: ListPostsInput): Promise<ListPostsResult> {
    try {
      return await listPinterestPins(connection, input);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Pinterest pins fetch failed', reason: 'transient' };
    }
  },

  async deletePost(connection, input: DeletePostInput): Promise<DeletePostResult> {
    try {
      return await deletePinterestPin(connection, input.externalId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Pinterest pin delete failed', reason: 'transient' };
    }
  },

  async testConnection(connection) {
    const accessToken = getAccessToken(connection);
    try {
      const res = await fetchWithRetry(getPinterestApiUrl('/user_account'), {
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
    const connectionEnvironment = getMeta<string>(connection, 'pinterestApiEnvironment', '');
    const configuredEnvironment = getPinterestApiEnvironment();
    if (connectionEnvironment && connectionEnvironment !== configuredEnvironment) {
      return `Pinterest is connected to ${connectionEnvironment}, but Markaestro is configured for ${configuredEnvironment}. Reconnect Pinterest.`;
    }
    if (!getBoardId(connection)) {
      return 'Pinterest board not selected. Pick a board from brand settings.';
    }
    return null;
  },
};
