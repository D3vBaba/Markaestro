import { decrypt } from '@/lib/crypto';
import { asXSettings } from '@/lib/public-api/post-settings';
import {
  reserveProviderUsage,
  xReadCostUsd,
  xUserReadCostUsd,
  xDeleteCostUsd,
  xWorkspaceHardBudgetUsd,
  xWriteCostUsd,
} from '@/lib/platform/cost-guardrails';
import {
  PlatformCapability,
  type AudienceFetchResult,
  type DeletePostInput,
  type DeletePostResult,
  type ListPostsInput,
  type ListPostsResult,
  type MetricsFetchInput,
  type MetricsFetchResult,
  type NormalizedPostMetrics,
  type PlatformAdapter,
  type PlatformConnection,
  type PublishRequest,
  type PublishResult,
} from '@/lib/platform/types';

const X_API = 'https://api.x.com/2';
const X_MEDIA_API = `${X_API}/media/upload`;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

type XErrorPayload = {
  title?: string;
  detail?: string;
  errors?: Array<{ message?: string; detail?: string }>;
};

function token(connection: PlatformConnection): string {
  return decrypt(connection.accessTokenEncrypted);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function responseError(response: Response, payload: Record<string, unknown>): string {
  const body = payload as XErrorPayload;
  const message = body.detail || body.title || body.errors?.[0]?.detail || body.errors?.[0]?.message || 'X API request failed';
  const reset = response.headers.get('x-rate-limit-reset');
  return response.status === 429 && reset
    ? `X API rate limited this request (429, reset ${reset}): ${message}`
    : `X API request failed (${response.status}): ${message}`;
}

async function xRequest(
  connection: PlatformConnection,
  url: string,
  init: RequestInit = {},
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token(connection)}`,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await json(response);
  return { response, payload };
}

function mediaId(payload: Record<string, unknown>): string | null {
  const data = payload.data && typeof payload.data === 'object'
    ? payload.data as Record<string, unknown>
    : payload;
  const value = data.id ?? data.media_id_string ?? data.media_id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function processingInfo(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = payload.data && typeof payload.data === 'object'
    ? payload.data as Record<string, unknown>
    : payload;
  return data.processing_info && typeof data.processing_info === 'object'
    ? data.processing_info as Record<string, unknown>
    : undefined;
}

async function uploadSimpleMedia(connection: PlatformConnection, blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('media', blob, 'media');
  form.append('media_category', 'tweet_image');
  const { response, payload } = await xRequest(connection, X_MEDIA_API, { method: 'POST', body: form });
  const id = mediaId(payload);
  if (!response.ok || !id) throw new Error(responseError(response, payload));
  return id;
}

async function uploadChunkedMedia(
  connection: PlatformConnection,
  blob: Blob,
  mediaType: string,
): Promise<string> {
  const category = mediaType === 'image/gif' ? 'tweet_gif' : 'tweet_video';
  const initBody = new FormData();
  initBody.append('command', 'INIT');
  initBody.append('total_bytes', String(blob.size));
  initBody.append('media_type', mediaType);
  initBody.append('media_category', category);
  const initResult = await xRequest(connection, X_MEDIA_API, {
    method: 'POST',
    body: initBody,
  });
  const id = mediaId(initResult.payload);
  if (!initResult.response.ok || !id) throw new Error(responseError(initResult.response, initResult.payload));

  let segment = 0;
  for (let offset = 0; offset < blob.size; offset += MAX_CHUNK_BYTES) {
    const form = new FormData();
    form.append('command', 'APPEND');
    form.append('media_id', id);
    form.append('segment_index', String(segment++));
    form.append('media', blob.slice(offset, Math.min(offset + MAX_CHUNK_BYTES, blob.size)), 'chunk');
    const appended = await xRequest(connection, X_MEDIA_API, { method: 'POST', body: form });
    if (!appended.response.ok) throw new Error(responseError(appended.response, appended.payload));
  }

  const finalizeBody = new FormData();
  finalizeBody.append('command', 'FINALIZE');
  finalizeBody.append('media_id', id);
  let finalized = await xRequest(connection, X_MEDIA_API, {
    method: 'POST',
    body: finalizeBody,
  });
  if (!finalized.response.ok) throw new Error(responseError(finalized.response, finalized.payload));

  for (let attempt = 0; attempt < 20; attempt++) {
    const info = processingInfo(finalized.payload);
    const state = typeof info?.state === 'string' ? info.state : 'succeeded';
    if (state === 'succeeded') return id;
    if (state === 'failed') throw new Error('X media processing failed');
    const seconds = typeof info?.check_after_secs === 'number' ? info.check_after_secs : 2;
    await new Promise((resolve) => setTimeout(resolve, Math.min(5, Math.max(1, seconds)) * 1000));
    finalized = await xRequest(connection, `${X_MEDIA_API}?command=STATUS&media_id=${encodeURIComponent(id)}`);
    if (!finalized.response.ok) throw new Error(responseError(finalized.response, finalized.payload));
  }
  throw new Error('X media is still processing');
}

async function uploadMedia(connection: PlatformConnection, url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not read media for X (${response.status})`);
  const blob = await response.blob();
  const type = blob.type || response.headers.get('content-type') || 'application/octet-stream';
  return type.startsWith('video/') || type === 'image/gif'
    ? uploadChunkedMedia(connection, blob, type)
    : uploadSimpleMedia(connection, blob);
}

function xMetrics(payload: Record<string, unknown>): NormalizedPostMetrics {
  const data = payload.data as Record<string, unknown> | undefined;
  const publicMetrics = data?.public_metrics as Record<string, unknown> | undefined;
  const privateMetrics = (data?.non_public_metrics ?? data?.organic_metrics) as Record<string, unknown> | undefined;
  const value = (record: Record<string, unknown> | undefined, key: string) =>
    typeof record?.[key] === 'number' ? record[key] as number : null;
  const reposts = value(publicMetrics, 'retweet_count');
  const quotes = value(publicMetrics, 'quote_count');
  const impressions = value(publicMetrics, 'impression_count') ?? value(privateMetrics, 'impression_count');
  return {
    impressions,
    views: impressions,
    reach: null,
    likes: value(publicMetrics, 'like_count'),
    comments: value(publicMetrics, 'reply_count'),
    shares: reposts == null && quotes == null ? null : (reposts ?? 0) + (quotes ?? 0),
    saves: value(publicMetrics, 'bookmark_count'),
    clicks: value(privateMetrics, 'url_link_clicks'),
    profileVisits: value(privateMetrics, 'user_profile_clicks'),
    followersGained: null,
    watchTimeSeconds: null,
    averageWatchTimeSeconds: null,
    completionRate: null,
    conversions: null,
    videoViews: null,
    raw: Object.fromEntries(
      [...Object.entries(publicMetrics ?? {}), ...Object.entries(privateMetrics ?? {})]
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    ),
  };
}

async function meterRead(connection: PlatformConnection, operation: string, estimatedCostUsd = xReadCostUsd()) {
  await reserveProviderUsage({
    workspaceId: connection.workspaceId,
    provider: 'x',
    operation,
    estimatedCostUsd,
    hardBudgetUsd: xWorkspaceHardBudgetUsd(),
  });
}

export const xPublishingAdapter: PlatformAdapter = {
  id: 'x-publishing',
  name: 'X Publishing',
  channels: ['x'],
  capabilities: [
    PlatformCapability.PUBLISH_TEXT,
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_VIDEO,
  ],

  async publish(connection: PlatformConnection, request: PublishRequest): Promise<PublishResult> {
    try {
      await reserveProviderUsage({
        workspaceId: connection.workspaceId,
        provider: 'x',
        operation: /https?:\/\//i.test(request.content) ? 'create_with_url' : 'create',
        estimatedCostUsd: xWriteCostUsd(request.content),
        hardBudgetUsd: xWorkspaceHardBudgetUsd(),
      });
      const urls = request.mediaUrls ?? [];
      const ids: string[] = [];
      for (const url of urls) ids.push(await uploadMedia(connection, url));
      const settings = asXSettings(request.settings);
      const body: Record<string, unknown> = { text: request.content };
      if (ids.length > 0) body.media = { media_ids: ids };
      if (settings?.replySettings) body.reply_settings = settings.replySettings;
      const { response, payload } = await xRequest(connection, `${X_API}/tweets`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = payload.data as Record<string, unknown> | undefined;
      const id = data?.id != null ? String(data.id) : '';
      if (!response.ok || !id) return { success: false, error: responseError(response, payload) };
      const username = typeof connection.metadata.username === 'string' ? connection.metadata.username : '';
      return {
        success: true,
        externalId: id,
        externalUrl: username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'X publish failed' };
    }
  },

  async testConnection(connection: PlatformConnection) {
    await meterRead(connection, 'test_connection', xUserReadCostUsd());
    const { response, payload } = await xRequest(connection, `${X_API}/users/me?user.fields=username,name`);
    const data = payload.data as Record<string, unknown> | undefined;
    return response.ok
      ? { ok: true, label: String(data?.username || data?.name || 'X') }
      : { ok: false, error: responseError(response, payload) };
  },

  validateConnection(connection: PlatformConnection, channel) {
    if (channel !== 'x') return 'X adapter cannot publish to this channel';
    if (!connection.accessTokenEncrypted) return 'X access token is missing';
    if (!connection.accountKey && !connection.metadata.xUserId) return 'X account identity is missing';
    return null;
  },

  async fetchMetrics(connection: PlatformConnection, input: MetricsFetchInput): Promise<MetricsFetchResult> {
    const fields = 'public_metrics,non_public_metrics,organic_metrics,created_at';
    await meterRead(connection, 'metrics');
    const { response, payload } = await xRequest(connection, `${X_API}/tweets/${encodeURIComponent(input.externalId)}?tweet.fields=${fields}`);
    if (response.ok) return { ok: true, metrics: xMetrics(payload) };
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'auth', error: responseError(response, payload) };
    if (response.status === 404) return { ok: false, reason: 'not_found', error: responseError(response, payload) };
    return { ok: false, reason: 'transient', error: responseError(response, payload) };
  },

  async fetchAudience(connection: PlatformConnection): Promise<AudienceFetchResult> {
    const accountId = connection.accountKey || String(connection.metadata.xUserId || '');
    await meterRead(connection, 'audience', xUserReadCostUsd());
    const { response, payload } = await xRequest(connection, `${X_API}/users/${encodeURIComponent(accountId)}?user.fields=public_metrics`);
    const data = payload.data as Record<string, unknown> | undefined;
    const metrics = data?.public_metrics as Record<string, unknown> | undefined;
    if (response.ok && typeof metrics?.followers_count === 'number') {
      return { ok: true, followers: metrics.followers_count };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'auth', error: responseError(response, payload) };
    return { ok: false, reason: 'transient', error: responseError(response, payload) };
  },

  async listPosts(connection: PlatformConnection, input: ListPostsInput): Promise<ListPostsResult> {
    const accountId = connection.accountKey || String(connection.metadata.xUserId || '');
    const requestedLimit = Math.min(100, Math.max(5, input.limit ?? 25));
    await meterRead(connection, 'list_posts', xReadCostUsd(requestedLimit));
    const params = new URLSearchParams({
      max_results: String(requestedLimit),
      'tweet.fields': 'created_at,attachments',
      expansions: 'attachments.media_keys',
      'media.fields': 'type,url,preview_image_url',
    });
    if (input.cursor) params.set('pagination_token', input.cursor);
    const { response, payload } = await xRequest(connection, `${X_API}/users/${encodeURIComponent(accountId)}/tweets?${params}`);
    if (!response.ok) {
      return { ok: false, reason: response.status === 401 || response.status === 403 ? 'auth' : 'transient', error: responseError(response, payload) };
    }
    const rows = Array.isArray(payload.data) ? payload.data as Array<Record<string, unknown>> : [];
    const username = typeof connection.metadata.username === 'string' ? connection.metadata.username : '';
    const meta = payload.meta as Record<string, unknown> | undefined;
    const includes = payload.includes && typeof payload.includes === 'object'
      ? payload.includes as Record<string, unknown>
      : {};
    const media = Array.isArray(includes.media)
      ? includes.media as Array<Record<string, unknown>>
      : [];
    const mediaByKey = new Map(media.map((item) => [String(item.media_key || ''), item]));
    return {
      ok: true,
      posts: rows.map((row) => {
        const attachments = row.attachments && typeof row.attachments === 'object'
          ? row.attachments as Record<string, unknown>
          : {};
        const keys = Array.isArray(attachments.media_keys)
          ? attachments.media_keys.map(String)
          : [];
        const attached = keys.map((key) => mediaByKey.get(key)).filter(Boolean) as Array<Record<string, unknown>>;
        const first = attached[0];
        const hasVideo = attached.some((item) => item.type === 'video' || item.type === 'animated_gif');
        const mediaType = attached.length === 0
          ? 'text' as const
          : hasVideo
            ? 'video' as const
            : attached.length > 1
              ? 'carousel' as const
              : 'image' as const;
        return {
          externalId: String(row.id || ''),
          channel: 'x' as const,
          content: typeof row.text === 'string' ? row.text : null,
          mediaType,
          mediaUrl: typeof first?.url === 'string' ? first.url : null,
          thumbnailUrl: typeof first?.preview_image_url === 'string'
            ? first.preview_image_url
            : typeof first?.url === 'string' ? first.url : null,
          permalink: username ? `https://x.com/${username}/status/${row.id}` : `https://x.com/i/web/status/${row.id}`,
          publishedAt: typeof row.created_at === 'string' ? row.created_at : null,
          canDelete: true,
        };
      }),
      ...(typeof meta?.next_token === 'string' ? { nextCursor: meta.next_token } : {}),
    };
  },

  async deletePost(connection: PlatformConnection, input: DeletePostInput): Promise<DeletePostResult> {
    await meterRead(connection, 'delete', xDeleteCostUsd());
    const { response, payload } = await xRequest(connection, `${X_API}/tweets/${encodeURIComponent(input.externalId)}`, { method: 'DELETE' });
    if (response.ok) return { ok: true };
    if (response.status === 404) return { ok: false, reason: 'not_found', error: responseError(response, payload) };
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'auth', error: responseError(response, payload) };
    return { ok: false, reason: 'transient', error: responseError(response, payload) };
  },
};
