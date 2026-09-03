/**
 * Markaestro SDK for TypeScript.
 *
 * A thin, hand-written client over the public API rather than a raw
 * generator dump: the API has enough subtlety (brand-bound keys, delivery
 * modes, idempotency, the draft-then-publish two-step) that the wrapper is
 * where the value is. The full surface, request/response schemas, and the
 * error catalogue live in the OpenAPI description at
 * `GET /api/public/v1/openapi.json`.
 *
 * What the wrapper does for you:
 *  - sends `Idempotency-Key` on every create automatically, so a retried
 *    request can never double-post;
 *  - retries 429 and transient 5xx with the server's own `Retry-After`;
 *  - folds the draft-then-publish two-step into `posts.createAndPublish()`;
 *  - verifies webhook signatures, constant-time, rotation grace included.
 */

export type SocialChannel =
  | 'facebook' | 'instagram' | 'tiktok' | 'threads' | 'pinterest' | 'linkedin' | 'x';

export type DeliveryMode = 'direct_publish' | 'platform_inbox' | 'manual_reminder';

export type PostTarget = {
  channel: SocialChannel;
  destinationId?: string;
  deliveryMode?: DeliveryMode;
  settings?: Record<string, unknown>;
};

export type CreatePostInput = {
  caption?: string;
  channel?: SocialChannel;
  targets?: PostTarget[];
  mediaAssetIds?: string[];
  scheduledAt?: string | null;
  productId?: string;
  destinationId?: string;
  deliveryMode?: DeliveryMode;
  settings?: Record<string, unknown>;
};

export type Post = {
  id: string;
  channel: string;
  targets: Array<{ channel: string; destinationId: string; deliveryMode: string }>;
  status: string;
  caption: string;
  productId: string;
  mediaAssetIds: string[];
  mediaUrls: string[];
  scheduledAt: string | null;
  publishedAt: string | null;
  externalId: string;
  externalUrl: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type JobRun = {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | string;
  message: string;
  resourceType: string;
  resourceId: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  [key: string]: unknown;
};

export type MediaAsset = {
  id: string;
  type: 'image' | 'video';
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  [key: string]: unknown;
};

export type EvergreenVariantInput = { caption: string; enabled?: boolean };

export type CreateEvergreenQueueInput = {
  sourcePostId: string;
  name: string;
  channels?: SocialChannel[];
  intervalDays?: number;
  timeZone?: string;
  localHour?: number;
  localMinute?: number;
  scheduleMode?: 'fixed' | 'learned';
  reviewPolicy?: 'approve_future_runs' | 'review_each_run';
  expiresAt?: string | null;
  variants: EvergreenVariantInput[];
};

export type EvergreenQueue = {
  id: string;
  sourcePostId: string;
  productId: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  channels: SocialChannel[];
  intervalDays: number;
  nextRunAt: string | null;
  reviewPolicy: 'approve_future_runs' | 'review_each_run';
  version: number;
  runCount: number;
  pauseReason: string | null;
  variants?: Array<EvergreenVariantInput & { id: string; position: number }>;
  [key: string]: unknown;
};

export type UpdateEvergreenQueueInput = {
  version: number;
  name?: string;
  intervalDays?: number;
  timeZone?: string;
  localHour?: number;
  localMinute?: number;
  scheduleMode?: 'fixed' | 'learned';
  reviewPolicy?: 'approve_future_runs' | 'review_each_run';
  expiresAt?: string | null;
  variants?: EvergreenVariantInput[];
};

export type EvergreenQueueAnalytics = {
  queueId: string;
  source: { views: number | null; reach: number | null; engagements: number | null; platformClicks: number | null };
  lifetime: {
    views: number | null;
    reach: number | null;
    engagements: number | null;
    platformClicks: number | null;
    trackedLinkClicks: number;
    attributedConversions: number;
    measuredOccurrences: number;
  };
  runs: { total: number; published: number; evaluated: number; underperforming: number; failed: number; skipped: number; needsReview: number };
  recentRuns: Array<Record<string, unknown>>;
};

export type Page<K extends string, T> = { [key in K]: T[] } & { nextCursor: string | null };

/** The API's error envelope, thrown as `MarkaestroError`. */
export class MarkaestroError extends Error {
  readonly status: number;
  readonly code: string;
  /** Server-authored copy safe to show a person; absent for most codes. */
  readonly userMessage?: string;
  readonly requestId?: string;
  readonly issues?: Array<{ channel?: string; code?: string; message: string }>;

  constructor(status: number, body: Record<string, unknown>) {
    const code = typeof body.error === 'string' ? body.error : `HTTP_${status}`;
    super(code);
    this.name = 'MarkaestroError';
    this.status = status;
    this.code = code;
    if (typeof body.userMessage === 'string') this.userMessage = body.userMessage;
    if (typeof body.requestId === 'string') this.requestId = body.requestId;
    if (Array.isArray(body.issues)) this.issues = body.issues as MarkaestroError['issues'];
  }
}

export type ClientOptions = {
  /** `mk_live_...` or `mk_test_...`. Test keys publish to the sandbox. */
  apiKey: string;
  baseUrl?: string;
  /** Pin a dated API version; defaults to the key's creation-date version. */
  apiVersion?: string;
  maxRetries?: number;
  fetch?: typeof fetch;
};

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `mk_idem_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class Markaestro {
  private readonly options: Required<Pick<ClientOptions, 'apiKey' | 'baseUrl' | 'maxRetries'>> &
    Pick<ClientOptions, 'apiVersion' | 'fetch'>;

  constructor(options: ClientOptions) {
    if (!options.apiKey?.startsWith('mk_')) {
      throw new Error('apiKey must be an mk_live_ or mk_test_ key from Settings > API');
    }
    this.options = {
      apiKey: options.apiKey,
      baseUrl: (options.baseUrl ?? 'https://markaestro.com').replace(/\/+$/, ''),
      maxRetries: options.maxRetries ?? 2,
      apiVersion: options.apiVersion,
      fetch: options.fetch,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const doFetch = this.options.fetch ?? fetch;
    const url = new URL(this.options.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.options.apiVersion) headers['Markaestro-Version'] = this.options.apiVersion;
    // Every mutation gets a key, minted once and reused across retries, which
    // is the entire point: the retry replays instead of double-creating.
    if (method !== 'GET' && method !== 'HEAD') headers['Idempotency-Key'] = randomKey();

    for (let attempt = 0; ; attempt++) {
      const response = await doFetch(url.toString(), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.options.maxRetries) {
        const retryAfter = Number(response.headers.get('Retry-After')) || 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      const text = await response.text();
      let parsed: Record<string, unknown>;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { error: 'MALFORMED_RESPONSE' };
      }
      if (!response.ok) throw new MarkaestroError(response.status, parsed);
      return parsed as T;
    }
  }

  readonly posts = {
    create: (input: CreatePostInput) =>
      this.request<{ post: Post }>('POST', '/api/public/v1/posts', input).then((r) => r.post),
    get: (id: string) =>
      this.request<{ post: Post }>('GET', `/api/public/v1/posts/${encodeURIComponent(id)}`).then((r) => r.post),
    list: (params: { limit?: number; cursor?: string; status?: string; productId?: string } = {}) =>
      this.request<Page<'posts', Post>>('GET', '/api/public/v1/posts', undefined, params),
    delete: (id: string) =>
      this.request<{ deleted: boolean; id: string }>('DELETE', `/api/public/v1/posts/${encodeURIComponent(id)}`),
    publish: (id: string) =>
      this.request<{ run: JobRun }>('POST', `/api/public/v1/posts/${encodeURIComponent(id)}/publish`),
    /** The draft-then-publish two-step as one call. */
    createAndPublish: async (input: CreatePostInput) => {
      const post = await this.posts.create(input);
      const run = await this.posts.publish(post.id);
      return { post, run };
    },
    bulk: (input: { ids: string[] } & (
      | { action: 'reschedule'; scheduledAt: string }
      | { action: 'delete' }
      | { action: 'status'; status: 'draft' | 'scheduled' }
    )) =>
      this.request<{ succeeded: string[]; failed: Array<{ id: string; error: string }> }>(
        'POST', '/api/public/v1/posts/bulk', input),
  };

  readonly media = {
    list: (params: { limit?: number; cursor?: string; type?: 'image' | 'video' } = {}) =>
      this.request<Page<'assets', MediaAsset>>('GET', '/api/public/v1/media', undefined, params),
    get: (id: string) =>
      this.request<{ asset: MediaAsset }>('GET', `/api/public/v1/media/${encodeURIComponent(id)}`).then((r) => r.asset),
    delete: (id: string) =>
      this.request<Record<string, unknown>>('DELETE', `/api/public/v1/media/${encodeURIComponent(id)}`),
  };

  readonly evergreen = {
    preview: (sourcePostId: string) =>
      this.request<Record<string, unknown>>('POST', '/api/public/v1/evergreen-queues/preview', { sourcePostId }),
    create: (input: CreateEvergreenQueueInput) =>
      this.request<{ queue: EvergreenQueue }>('POST', '/api/public/v1/evergreen-queues', input).then((r) => r.queue),
    list: () =>
      this.request<{ queues: EvergreenQueue[]; count: number }>('GET', '/api/public/v1/evergreen-queues'),
    get: (id: string) =>
      this.request<{ queue: EvergreenQueue }>('GET', `/api/public/v1/evergreen-queues/${encodeURIComponent(id)}`).then((r) => r.queue),
    update: (id: string, input: UpdateEvergreenQueueInput) =>
      this.request<{ queue: EvergreenQueue }>('PATCH', `/api/public/v1/evergreen-queues/${encodeURIComponent(id)}`, input).then((r) => r.queue),
    activate: (id: string) =>
      this.request<{ queue: EvergreenQueue }>('POST', `/api/public/v1/evergreen-queues/${encodeURIComponent(id)}/activate`).then((r) => r.queue),
    pause: (id: string) =>
      this.request<{ queue: EvergreenQueue }>('POST', `/api/public/v1/evergreen-queues/${encodeURIComponent(id)}/pause`).then((r) => r.queue),
    resume: (id: string) =>
      this.request<{ queue: EvergreenQueue }>('POST', `/api/public/v1/evergreen-queues/${encodeURIComponent(id)}/resume`).then((r) => r.queue),
    archive: (id: string) =>
      this.request<{ queue: EvergreenQueue }>('DELETE', `/api/public/v1/evergreen-queues/${encodeURIComponent(id)}`).then((r) => r.queue),
    runs: (id: string) =>
      this.request<{ runs: Array<Record<string, unknown>>; count: number }>('GET', `/api/public/v1/evergreen-queues/${encodeURIComponent(id)}/runs`),
    analytics: (id: string) =>
      this.request<{ analytics: EvergreenQueueAnalytics }>('GET', `/api/public/v1/evergreen-queues/${encodeURIComponent(id)}/analytics`).then((r) => r.analytics),
  };

  readonly jobRuns = {
    get: (id: string) =>
      this.request<{ run: JobRun }>('GET', `/api/public/v1/job-runs/${encodeURIComponent(id)}`).then((r) => r.run),
    list: (params: { limit?: number; cursor?: string; status?: string; resourceId?: string } = {}) =>
      this.request<Page<'runs', JobRun>>('GET', '/api/public/v1/job-runs', undefined, params),
  };

  readonly webhookEndpoints = {
    list: () =>
      this.request<{ webhookEndpoints: Array<Record<string, unknown>> }>('GET', '/api/public/v1/webhook-endpoints'),
    create: (input: { url: string; events: string[] }) =>
      this.request<{ webhookEndpoint: Record<string, unknown> }>('POST', '/api/public/v1/webhook-endpoints', input),
    delete: (id: string) =>
      this.request<Record<string, unknown>>('DELETE', `/api/public/v1/webhook-endpoints/${encodeURIComponent(id)}`),
  };
}

// ── Webhook verification ─────────────────────────────────────────────

/**
 * Verify a webhook delivery. Sign the RAW body, compare constant-time, and
 * reject stale timestamps; accepts either signature during a secret rotation.
 */
export async function verifyWebhook(input: {
  rawBody: string | Uint8Array;
  headers: Record<string, string | string[] | undefined>;
  secret: string;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const header = (name: string): string | undefined => {
    const value = input.headers[name] ?? input.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  const timestamp = header('X-Markaestro-Timestamp');
  if (!timestamp) return false;
  const age = Date.now() - Date.parse(timestamp);
  const tolerance = (input.toleranceSeconds ?? 300) * 1000;
  if (!Number.isFinite(age) || age > tolerance) return false;

  const encoder = new TextEncoder();
  const bodyBytes = typeof input.rawBody === 'string' ? encoder.encode(input.rawBody) : input.rawBody;
  const prefix = encoder.encode(`${timestamp}.`);
  const signedBytes = new Uint8Array(prefix.length + bodyBytes.length);
  signedBytes.set(prefix);
  signedBytes.set(bodyBytes, prefix.length);

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(input.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, signedBytes));
  const expected = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');

  const candidates = [header('X-Markaestro-Signature'), header('X-Markaestro-Signature-Previous')]
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (candidate.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}
