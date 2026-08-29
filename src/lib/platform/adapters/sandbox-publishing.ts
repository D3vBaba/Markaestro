import crypto from 'crypto';
import type { SocialChannel } from '@/lib/schemas';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';
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
} from '../types';

/**
 * The adapter test-mode keys publish through.
 *
 * An integrator's first call previously went to a real platform API against a
 * real account, which meant the only way to find out what a publish response
 * looks like was to publish something. This adapter answers with the same
 * shapes the real ones do, deterministically, and never opens a socket.
 *
 * It is deliberately absent from `registry.ts`: `getAdapterForChannel` must
 * keep returning the real adapter for every channel, or a bug in the routing
 * would silently stop publishing live posts. Test-mode routing is an explicit
 * branch in `publishPost`, keyed on the post's own `testMode` flag.
 *
 * Everything it returns is derived from the request, so the same post yields
 * the same external id on every call. That matters more than realism: an
 * integrator writing tests against sandbox output needs the output to be
 * stable, and a random id would make every assertion flaky.
 */

/** Prefix on every id this adapter mints, so test data is greppable. */
const SANDBOX_ID_PREFIX = 'mk_test_';

/**
 * Markers an integrator puts in a caption to force a specific failure.
 *
 * The point is that error handling can be written before the error happens.
 * Without these the only way to see a rate-limit response is to be rate
 * limited, which is not a thing anyone can arrange on purpose.
 */
export const SANDBOX_FAILURE_MARKERS = {
  TEST_FAIL_RATE_LIMIT: 'The platform rate limited this request. Retry after the window resets.',
  TEST_FAIL_AUTH: 'The platform rejected the access token. Reconnect the account.',
  TEST_FAIL_VALIDATION: 'The platform rejected the post content.',
  TEST_FAIL_TRANSIENT: 'The platform returned a temporary error. This publish can be retried.',
} as const;

/** Markers that produce a non-failure outcome other than plain success. */
export const SANDBOX_OUTCOME_MARKERS = {
  TEST_PENDING: 'pending',
  TEST_ACTION_REQUIRED: 'action_required',
} as const;

export type SandboxMarker =
  | keyof typeof SANDBOX_FAILURE_MARKERS
  | keyof typeof SANDBOX_OUTCOME_MARKERS;

/** Every marker, for the documentation generator and the settings UI. */
export function listSandboxMarkers(): Array<{ marker: SandboxMarker; effect: string }> {
  return [
    ...Object.entries(SANDBOX_FAILURE_MARKERS).map(([marker, effect]) => ({
      marker: marker as SandboxMarker,
      effect: `Publish fails with: ${effect}`,
    })),
    {
      marker: 'TEST_PENDING' as SandboxMarker,
      effect: 'Publish returns pending, as a video upload awaiting platform processing does.',
    },
    {
      marker: 'TEST_ACTION_REQUIRED' as SandboxMarker,
      effect: 'Publish returns action required, as a manual reminder or platform inbox hand-off does.',
    },
  ];
}

function findMarker(content: string): SandboxMarker | null {
  const haystack = content.toUpperCase();
  for (const marker of Object.keys(SANDBOX_FAILURE_MARKERS)) {
    if (haystack.includes(marker)) return marker as SandboxMarker;
  }
  for (const marker of Object.keys(SANDBOX_OUTCOME_MARKERS)) {
    if (haystack.includes(marker)) return marker as SandboxMarker;
  }
  return null;
}

/**
 * A stable id for a (channel, content, media) triple.
 *
 * Truncated to 16 hex characters, which is long enough that two different
 * posts in one workspace will not collide and short enough to read in a log.
 */
export function sandboxExternalId(request: Pick<PublishRequest, 'channel' | 'content' | 'mediaUrls'>): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${request.channel}\n${request.content}\n${(request.mediaUrls ?? []).join('\n')}`)
    .digest('hex')
    .slice(0, 16);
  return `${SANDBOX_ID_PREFIX}${digest}`;
}

/** Whether an external id was minted by this adapter. */
export function isSandboxExternalId(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(SANDBOX_ID_PREFIX);
}

function sandboxPermalink(channel: SocialChannel, externalId: string): string {
  return `https://sandbox.markaestro.invalid/${channel}/${externalId}`;
}

/**
 * Plausible metrics derived from the external id.
 *
 * Fabricated numbers in a sandbox are fine, and fabricated numbers in live
 * analytics are not, which is why `testMode` posts are excluded from every
 * rollup (see `analytics/worker.ts`). The values are stable per post so an
 * integrator can assert on them.
 */
export function sandboxMetrics(externalId: string, channel: SocialChannel): NormalizedPostMetrics {
  const seed = parseInt(externalId.slice(-8) || '0', 16) || 1;
  const scale = (n: number) => (seed % n) + Math.floor(n / 4);
  const config = getSocialChannelConfig(channel);
  const supportsVideo = config ? config.mediaKinds.includes('video') : true;
  const views = scale(5000);
  return {
    impressions: views,
    views,
    reach: Math.floor(views * 0.8),
    likes: scale(400),
    comments: scale(40),
    shares: scale(25),
    saves: scale(30),
    clicks: scale(120),
    profileVisits: scale(60),
    followersGained: scale(12),
    watchTimeSeconds: supportsVideo ? scale(9000) : null,
    averageWatchTimeSeconds: supportsVideo ? scale(20) : null,
    completionRate: supportsVideo ? (seed % 100) / 100 : null,
    conversions: null,
    videoViews: supportsVideo ? Math.floor(views * 0.6) : null,
    source: { provider: 'sandbox', apiVersion: 'sandbox-1', measuredAt: undefined },
    raw: {},
  };
}

export const sandboxPublishingAdapter: PlatformAdapter = {
  id: 'sandbox-publishing',
  name: 'Sandbox',
  // Every channel: a test key targets whichever channel the integrator is
  // building against, and refusing one would send them back to production.
  channels: ['facebook', 'instagram', 'tiktok', 'threads', 'pinterest', 'linkedin'],
  capabilities: [
    PlatformCapability.PUBLISH_TEXT,
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_VIDEO,
    PlatformCapability.PUBLISH_CAROUSEL,
  ],

  async publish(_connection: PlatformConnection, request: PublishRequest): Promise<PublishResult> {
    const marker = findMarker(request.content || '');
    const externalId = sandboxExternalId(request);

    if (marker && marker in SANDBOX_FAILURE_MARKERS) {
      return {
        success: false,
        error: SANDBOX_FAILURE_MARKERS[marker as keyof typeof SANDBOX_FAILURE_MARKERS],
      };
    }
    if (marker === 'TEST_PENDING') {
      return { success: false, pending: true, externalId };
    }
    if (marker === 'TEST_ACTION_REQUIRED') {
      return {
        success: false,
        actionRequired: true,
        nextAction: 'Finish this post in the sandbox. Nothing was sent to a platform.',
      };
    }

    return {
      success: true,
      externalId,
      externalUrl: sandboxPermalink(request.channel, externalId),
    };
  },

  async testConnection(): Promise<{ ok: boolean; label?: string; error?: string }> {
    return { ok: true, label: 'Sandbox account' };
  },

  validateConnection(): string | null {
    // A test key does not need a connected account: the whole point is that an
    // integrator can exercise the API before wiring up OAuth.
    return null;
  },

  async fetchMetrics(_connection: PlatformConnection, input: MetricsFetchInput): Promise<MetricsFetchResult> {
    if (!isSandboxExternalId(input.externalId)) {
      return { ok: false, error: 'Not a sandbox post', reason: 'not_found' };
    }
    return { ok: true, metrics: sandboxMetrics(input.externalId, input.channel) };
  },

  async fetchAudience(_connection: PlatformConnection, channel: SocialChannel): Promise<AudienceFetchResult> {
    const seed = channel.length * 137;
    return { ok: true, followers: 1000 + seed };
  },

  async listPosts(_connection: PlatformConnection, input: ListPostsInput): Promise<ListPostsResult> {
    // Nothing is stored on a platform, so there is nothing to enumerate. This
    // is the honest answer, and it is what an account with no posts returns.
    void input;
    return { ok: true, posts: [] };
  },

  async deletePost(_connection: PlatformConnection, input: DeletePostInput): Promise<DeletePostResult> {
    if (!isSandboxExternalId(input.externalId)) {
      return { ok: false, error: 'Not a sandbox post', reason: 'not_found' };
    }
    return { ok: true };
  },
};
