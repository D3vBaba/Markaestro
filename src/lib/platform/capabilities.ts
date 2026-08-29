import type { SocialChannel } from '@/lib/schemas';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';
import { normalizedMetricKeys, type NormalizedMetricKey, type NormalizedPostMetrics } from './types';

export type MetricCapabilityState =
  | 'available'
  | 'unsupported'
  | 'missing_scope'
  | 'account_ineligible'
  | 'delayed'
  | 'unknown_api_error';

export type PlatformMetricCapability = {
  state: Exclude<MetricCapabilityState, 'delayed' | 'unknown_api_error'>;
  requiredScopes?: readonly string[];
  notes?: string;
  eligibleContentTypes?: readonly string[];
  threshold?: string;
};

export type PlatformCapabilityContract = {
  platform: SocialChannel;
  apiProduct: string;
  apiHost: string;
  apiVersion: string;
  rateLimitCategory: string;
  requiredScopes: readonly string[];
  approval: {
    status: 'standard' | 'review_required' | 'restricted';
    reconnectRequired: boolean;
    reviewRequirements: string;
    rateLimitNotes: string;
    docsUrl: string;
    lastAuditedAt: string;
    sunsetAt: string | null;
  };
  publishing: {
    text: boolean;
    image: boolean;
    video: boolean;
    carousel: boolean;
    markaestroScheduling: true;
    nativeScheduling: boolean;
  };
  history: {
    nativePostImport: boolean;
    lookbackDays: number | null;
  };
  metrics: Record<NormalizedMetricKey, PlatformMetricCapability>;
  audienceDimensions: {
    country: PlatformMetricCapability;
    city: PlatformMetricCapability;
    age: PlatformMetricCapability;
    gender: PlatformMetricCapability;
    industry: PlatformMetricCapability;
    interests: PlatformMetricCapability;
  };
};

const available = (
  requiredScopes?: readonly string[],
  extra: Omit<PlatformMetricCapability, 'state' | 'requiredScopes'> = {},
): PlatformMetricCapability => ({ state: 'available', ...(requiredScopes ? { requiredScopes } : {}), ...extra });

const unsupported = (notes?: string): PlatformMetricCapability => ({
  state: 'unsupported',
  ...(notes ? { notes } : {}),
});

const accountEligible = (
  requiredScopes: readonly string[],
  notes: string,
  extra: Omit<PlatformMetricCapability, 'state' | 'requiredScopes' | 'notes'> = {},
): PlatformMetricCapability => ({ state: 'account_ineligible', requiredScopes, notes, ...extra });

const metricDefaults = (): Record<NormalizedMetricKey, PlatformMetricCapability> => ({
  impressions: unsupported(),
  views: unsupported(),
  reach: unsupported(),
  likes: unsupported(),
  comments: unsupported(),
  shares: unsupported(),
  saves: unsupported(),
  clicks: unsupported(),
  profileVisits: unsupported(),
  followersGained: unsupported(),
  watchTimeSeconds: unsupported(),
  averageWatchTimeSeconds: unsupported(),
  completionRate: unsupported(),
  conversions: unsupported('Organic conversion reporting is not exposed by this connection.'),
  videoViews: unsupported(),
});

function metrics(
  overrides: Partial<Record<NormalizedMetricKey, PlatformMetricCapability>>,
): Record<NormalizedMetricKey, PlatformMetricCapability> {
  return { ...metricDefaults(), ...overrides };
}

const facebookScopes = ['pages_read_engagement', 'read_insights'] as const;
const instagramScopes = ['instagram_business_manage_insights'] as const;
const threadsScopes = ['threads_manage_insights'] as const;
const linkedInMemberAnalyticsScopes = ['r_member_postAnalytics'] as const;
const pinterestReadScopes = ['pins:read', 'user_accounts:read'] as const;

export const PLATFORM_CAPABILITY_REGISTRY: Readonly<Record<SocialChannel, PlatformCapabilityContract>> = {
  facebook: {
    platform: 'facebook',
    apiProduct: 'Meta Pages API',
    apiHost: 'https://graph.facebook.com',
    apiVersion: 'v25.0',
    rateLimitCategory: 'meta-page',
    requiredScopes: ['pages_manage_posts', 'pages_read_engagement', 'read_insights'],
    approval: { status: 'review_required', reconnectRequired: true, reviewRequirements: 'Meta App Review is required for Page publishing and insights scopes.', rateLimitNotes: 'Observe Graph API app and Page usage headers.', docsUrl: 'https://developers.facebook.com/docs/graph-api/', lastAuditedAt: '2026-08-25', sunsetAt: null },
    publishing: { text: true, image: true, video: true, carousel: true, markaestroScheduling: true, nativeScheduling: false },
    history: { nativePostImport: true, lookbackDays: 90 },
    metrics: metrics({
      impressions: available(facebookScopes, { notes: 'Represented by post_media_view on current Pages APIs.' }),
      views: available(facebookScopes),
      reach: available(facebookScopes, { notes: 'Unique media views where returned.' }),
      likes: available(['pages_read_engagement'], { notes: 'May require pages_read_user_content for some posts.' }),
      comments: available(['pages_read_engagement'], { notes: 'May require pages_read_user_content for some posts.' }),
      shares: available(['pages_read_engagement']),
      clicks: available(facebookScopes),
      videoViews: available(facebookScopes, { eligibleContentTypes: ['video'] }),
    }),
    audienceDimensions: {
      country: accountEligible(facebookScopes, 'Availability depends on the Page insights metrics currently enabled by Meta.'),
      city: accountEligible(facebookScopes, 'Availability depends on the Page insights metrics currently enabled by Meta.'),
      age: accountEligible(facebookScopes, 'Availability depends on Page eligibility and privacy thresholds.'),
      gender: accountEligible(facebookScopes, 'Availability depends on Page eligibility and privacy thresholds.'),
      industry: unsupported(),
      interests: unsupported(),
    },
  },
  instagram: {
    platform: 'instagram',
    apiProduct: 'Instagram API with Instagram Login',
    apiHost: 'https://graph.instagram.com',
    apiVersion: 'v25.0',
    rateLimitCategory: 'instagram-business',
    requiredScopes: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
    approval: { status: 'review_required', reconnectRequired: true, reviewRequirements: 'Advanced Access and an eligible professional account are required.', rateLimitNotes: 'Observe Graph API usage headers and container limits.', docsUrl: 'https://developers.facebook.com/docs/instagram-platform/', lastAuditedAt: '2026-08-25', sunsetAt: null },
    publishing: { text: false, image: true, video: true, carousel: true, markaestroScheduling: true, nativeScheduling: false },
    history: { nativePostImport: true, lookbackDays: 90 },
    metrics: metrics({
      impressions: available(instagramScopes, { notes: 'Normalized from views on API versions where impressions is retired.' }),
      views: available(instagramScopes),
      reach: available(instagramScopes),
      likes: available(instagramScopes),
      comments: available(instagramScopes),
      shares: available(instagramScopes),
      saves: available(instagramScopes),
      profileVisits: accountEligible(instagramScopes, 'Returned only for eligible media/account insight combinations.'),
      watchTimeSeconds: accountEligible(instagramScopes, 'Available for eligible Reels only.', { eligibleContentTypes: ['video'] }),
      averageWatchTimeSeconds: accountEligible(instagramScopes, 'Available for eligible Reels only.', { eligibleContentTypes: ['video'] }),
      videoViews: available(instagramScopes, { eligibleContentTypes: ['video'] }),
    }),
    audienceDimensions: {
      country: accountEligible(instagramScopes, 'Professional account and privacy thresholds apply.'),
      city: accountEligible(instagramScopes, 'Professional account and privacy thresholds apply.'),
      age: accountEligible(instagramScopes, 'Professional account and privacy thresholds apply.'),
      gender: accountEligible(instagramScopes, 'Professional account and privacy thresholds apply.'),
      industry: unsupported(),
      interests: unsupported(),
    },
  },
  tiktok: {
    platform: 'tiktok',
    apiProduct: 'TikTok Display API and Content Posting API',
    apiHost: 'https://open.tiktokapis.com',
    apiVersion: 'v2',
    rateLimitCategory: 'tiktok-display',
    requiredScopes: ['user.info.basic', 'video.list', 'video.publish', 'video.upload'],
    approval: { status: 'review_required', reconnectRequired: true, reviewRequirements: 'TikTok app review and Content Posting audit requirements apply.', rateLimitNotes: 'Respect endpoint-specific quotas and Retry-After.', docsUrl: 'https://developers.tiktok.com/doc/display-api-overview/', lastAuditedAt: '2026-08-25', sunsetAt: null },
    publishing: { text: false, image: true, video: true, carousel: false, markaestroScheduling: true, nativeScheduling: false },
    history: { nativePostImport: true, lookbackDays: 90 },
    metrics: metrics({
      views: available(['video.list']),
      likes: available(['video.list']),
      comments: available(['video.list']),
      shares: available(['video.list']),
      videoViews: available(['video.list']),
    }),
    audienceDimensions: {
      country: unsupported('TikTok Display API does not expose audience geography.'),
      city: unsupported(),
      age: unsupported('TikTok Display API does not expose audience demographics.'),
      gender: unsupported(),
      industry: unsupported(),
      interests: unsupported(),
    },
  },
  threads: {
    platform: 'threads',
    apiProduct: 'Threads API',
    apiHost: 'https://graph.threads.net',
    apiVersion: 'v1.0',
    rateLimitCategory: 'threads',
    requiredScopes: ['threads_basic', 'threads_content_publish', 'threads_manage_insights'],
    approval: { status: 'review_required', reconnectRequired: true, reviewRequirements: 'Meta App Review is required for publishing and insights.', rateLimitNotes: 'Observe Threads/Graph usage headers.', docsUrl: 'https://developers.facebook.com/docs/threads/', lastAuditedAt: '2026-08-25', sunsetAt: null },
    publishing: { text: true, image: true, video: true, carousel: true, markaestroScheduling: true, nativeScheduling: false },
    history: { nativePostImport: true, lookbackDays: 90 },
    metrics: metrics({
      impressions: available(threadsScopes, { notes: 'Normalized from views.' }),
      views: available(threadsScopes),
      likes: available(threadsScopes),
      comments: available(threadsScopes, { notes: 'Replies are normalized as comments.' }),
      shares: available(threadsScopes, { notes: 'Reposts are normalized as shares; sends/quotes remain raw.' }),
      clicks: accountEligible(threadsScopes, 'Clicks are account-level, not post-level.'),
    }),
    audienceDimensions: {
      country: accountEligible(threadsScopes, 'Follower-demographic privacy thresholds apply.'),
      city: accountEligible(threadsScopes, 'Follower-demographic privacy thresholds apply.'),
      age: accountEligible(threadsScopes, 'Follower-demographic privacy thresholds apply.'),
      gender: accountEligible(threadsScopes, 'Follower-demographic privacy thresholds apply.'),
      industry: unsupported(),
      interests: unsupported(),
    },
  },
  linkedin: {
    platform: 'linkedin',
    apiProduct: 'LinkedIn Community Management API',
    apiHost: 'https://api.linkedin.com/rest',
    apiVersion: '202608',
    rateLimitCategory: 'linkedin-community-management',
    requiredScopes: ['w_member_social', 'r_member_postAnalytics', 'r_member_profileAnalytics'],
    approval: { status: 'restricted', reconnectRequired: true, reviewRequirements: 'Community Management and member analytics products require LinkedIn approval.', rateLimitNotes: 'Use LinkedIn rate-limit headers and daily application/member budgets.', docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/versioning', lastAuditedAt: '2026-08-25', sunsetAt: null },
    publishing: { text: true, image: true, video: true, carousel: true, markaestroScheduling: true, nativeScheduling: false },
    history: { nativePostImport: true, lookbackDays: 90 },
    metrics: metrics({
      impressions: available(linkedInMemberAnalyticsScopes),
      views: available(linkedInMemberAnalyticsScopes),
      reach: available(linkedInMemberAnalyticsScopes),
      likes: available(['r_organization_social'], { notes: 'Member analytics uses r_member_postAnalytics; public counts may be a fallback.' }),
      comments: available(['r_organization_social']),
      shares: available(linkedInMemberAnalyticsScopes),
      saves: available(linkedInMemberAnalyticsScopes),
      clicks: available(linkedInMemberAnalyticsScopes),
      profileVisits: available(linkedInMemberAnalyticsScopes),
      followersGained: available(linkedInMemberAnalyticsScopes),
      watchTimeSeconds: accountEligible(['r_member_postAnalytics'], 'Separate member/organization video analytics eligibility applies.', { eligibleContentTypes: ['video'] }),
      videoViews: accountEligible(['r_member_postAnalytics'], 'Separate member/organization video analytics eligibility applies.', { eligibleContentTypes: ['video'] }),
    }),
    audienceDimensions: {
      country: accountEligible(['r_member_profileAnalytics'], 'Member/profile or organization follower analytics approval is required.'),
      city: accountEligible(['r_member_profileAnalytics'], 'Member/profile or organization follower analytics approval is required.'),
      age: unsupported(),
      gender: unsupported(),
      industry: accountEligible(['r_member_profileAnalytics'], 'Member/profile or organization follower analytics approval is required.'),
      interests: unsupported(),
    },
  },
  pinterest: {
    platform: 'pinterest',
    apiProduct: 'Pinterest API',
    apiHost: 'https://api.pinterest.com',
    apiVersion: 'v5',
    rateLimitCategory: 'org_analytics',
    requiredScopes: ['boards:read', 'pins:read', 'user_accounts:read'],
    approval: { status: 'review_required', reconnectRequired: true, reviewRequirements: 'Pinterest app approval and eligible business context are required for analytics.', rateLimitNotes: 'Batch eligible Pins and honor endpoint rate-limit headers.', docsUrl: 'https://developers.pinterest.com/docs/analytics-and-reports/organic-reporting/', lastAuditedAt: '2026-08-25', sunsetAt: null },
    // carousel: true. The catalog allows 5 media items with `carousel` in
    // mediaKinds and the adapter builds a real multiple_image_urls pin source,
    // so the `false` that stood here was the only wrong copy of three.
    publishing: { text: false, image: true, video: true, carousel: true, markaestroScheduling: true, nativeScheduling: false },
    history: { nativePostImport: true, lookbackDays: 90 },
    metrics: metrics({
      impressions: available(pinterestReadScopes),
      views: available(pinterestReadScopes, { notes: 'Normalized from impressions.' }),
      likes: available(pinterestReadScopes, { notes: 'Reactions are normalized as likes.' }),
      comments: available(pinterestReadScopes),
      saves: available(pinterestReadScopes),
      clicks: available(pinterestReadScopes, { notes: 'Outbound clicks are canonical; Pin clicks remain raw.' }),
      profileVisits: available(pinterestReadScopes),
      followersGained: available(pinterestReadScopes),
      videoViews: accountEligible(pinterestReadScopes, 'Only eligible video Pins return video metrics.', { eligibleContentTypes: ['video'] }),
      watchTimeSeconds: accountEligible(pinterestReadScopes, 'Only eligible video Pins return video metrics.', { eligibleContentTypes: ['video'] }),
      averageWatchTimeSeconds: accountEligible(pinterestReadScopes, 'Only eligible video Pins return video metrics.', { eligibleContentTypes: ['video'] }),
      completionRate: accountEligible(pinterestReadScopes, 'Only eligible video Pins return completion metrics.', { eligibleContentTypes: ['video'] }),
    }),
    audienceDimensions: {
      country: accountEligible(['ads:read'], 'Pinterest audience insights require an eligible business/ad account.'),
      city: accountEligible(['ads:read'], 'Pinterest audience insights require an eligible business/ad account.'),
      age: accountEligible(['ads:read'], 'Pinterest audience insights require an eligible business/ad account.'),
      gender: accountEligible(['ads:read'], 'Pinterest audience insights require an eligible business/ad account.'),
      industry: unsupported(),
      interests: accountEligible(['ads:read'], 'Pinterest audience insights require an eligible business/ad account.'),
    },
  },
};

export type ResolvedPlatformMetricCapability = PlatformMetricCapability & {
  state: MetricCapabilityState;
  missingScopes?: string[];
};

export type ResolvedPlatformCapabilities = Omit<PlatformCapabilityContract, 'metrics'> & {
  metrics: Record<NormalizedMetricKey, ResolvedPlatformMetricCapability>;
};

/** Resolve static support against the scopes actually granted to one connection. */
export function resolvePlatformCapabilities(
  channel: SocialChannel,
  grantedScopes: readonly string[] = [],
): ResolvedPlatformCapabilities {
  const contract = PLATFORM_CAPABILITY_REGISTRY[channel];
  const scopeSet = new Set(grantedScopes);
  const resolved = Object.fromEntries(
    Object.entries(contract.metrics).map(([key, capability]) => {
      if (capability.state !== 'available' || !capability.requiredScopes?.length) {
        return [key, capability];
      }
      const missingScopes = capability.requiredScopes.filter((scope) => !scopeSet.has(scope));
      return [key, missingScopes.length > 0
        ? { ...capability, state: 'missing_scope' as const, missingScopes }
        : capability];
    }),
  ) as Record<NormalizedMetricKey, ResolvedPlatformMetricCapability>;
  return { ...contract, metrics: resolved };
}

export function capabilityForMetric(
  channel: SocialChannel,
  metric: NormalizedMetricKey,
): PlatformMetricCapability {
  return PLATFORM_CAPABILITY_REGISTRY[channel].metrics[metric];
}

/** Runtime adapter contract: an adapter may not emit a metric its registry marks unsupported. */
export function assertMetricsSupported(channel: SocialChannel, metrics: NormalizedPostMetrics): void {
  for (const key of normalizedMetricKeys) {
    if (metrics[key] == null) continue;
    if (PLATFORM_CAPABILITY_REGISTRY[channel].metrics[key].state === 'unsupported') {
      throw new Error(`PLATFORM_CAPABILITY_CONTRACT:${channel}:${key}`);
    }
  }
}

export type PublishingCapabilities = PlatformCapabilityContract['publishing'];

/**
 * Channels whose own platform scheduler we hand posts to.
 *
 * Empty today: every channel is scheduled by Markaestro's worker. Kept as an
 * explicit set rather than a comment so `publishingCapabilitiesFor` has one
 * source for the fact, and so adding a channel here is the whole change.
 */
const NATIVE_SCHEDULING = new Set<SocialChannel>();

/**
 * What a channel can actually publish, derived from the channel catalog.
 *
 * The registry's `publishing` block and the catalog's `mediaKinds` are two
 * statements of one fact, and having two copies is how Pinterest ended up
 * declaring `carousel: false` while the catalog allowed 5 media items and the
 * adapter built a real `multiple_image_urls` pin source. The catalog is the
 * better base: it carries the numeric limits the validator needs, and the
 * registry only carries booleans.
 *
 * `nativeScheduling` stays hand-maintained on the registry. It is a fact about
 * the platform's own scheduler, not about what we can send, so nothing in the
 * catalog can derive it.
 */
export function publishingCapabilitiesFor(channel: SocialChannel): PublishingCapabilities {
  const config = getSocialChannelConfig(channel);
  if (!config) throw new Error(`PLATFORM_CAPABILITY_UNKNOWN_CHANNEL:${channel}`);
  return {
    text: config.mediaKinds.includes('text'),
    image: config.mediaKinds.includes('image'),
    video: config.mediaKinds.includes('video'),
    carousel: config.mediaKinds.includes('carousel') && config.maxMediaItems > 1,
    markaestroScheduling: true,
    nativeScheduling: NATIVE_SCHEDULING.has(channel),
  };
}

/** The shape of one outbound publish, in the terms the contract is written in. */
export type PublishPayloadShape = {
  hasText: boolean;
  imageCount: number;
  videoCount: number;
};

/**
 * Runtime publishing contract, the counterpart to `assertMetricsSupported`.
 *
 * The metrics half of this registry has policed every adapter response since
 * it was written. The publishing half had no enforcement at all, so a drifted
 * declaration cost nothing until a user hit it. Returns a user-facing reason
 * rather than throwing, because every caller is already in the business of
 * turning a refusal into a per-channel message.
 */
export function publishingContractViolation(
  channel: SocialChannel,
  payload: PublishPayloadShape,
): string | null {
  const capabilities = publishingCapabilitiesFor(channel);
  const config = getSocialChannelConfig(channel);
  const label = config?.label ?? channel;
  const mediaCount = payload.imageCount + payload.videoCount;

  if (payload.videoCount > 0 && !capabilities.video) {
    return `${label} does not support video posts.`;
  }
  if (payload.imageCount > 0 && !capabilities.image) {
    return `${label} does not support image posts.`;
  }
  if (mediaCount === 0 && !capabilities.text) {
    return `${label} requires at least one image or video. Text-only posts are not supported.`;
  }
  // The numeric limit, not the `carousel` flag. TikTok photo posts carry up to
  // 35 images and are not a carousel in the platform's own vocabulary, so
  // gating multi-image on `carousel` would refuse a post the product has
  // always supported. `carousel` describes the format a platform exposes;
  // `maxMediaItems` is the constraint a payload has to satisfy.
  if (config && mediaCount > 1 && config.maxMediaItems <= 1) {
    return `${label} allows one media item per post. This post has ${mediaCount}.`;
  }
  if (config && mediaCount > config.maxMediaItems) {
    return `${label} allows a maximum of ${config.maxMediaItems} media items per post. This post has ${mediaCount}.`;
  }
  if (!payload.hasText && mediaCount === 0) {
    return `${label} posts need a caption, an image, or a video.`;
  }
  return null;
}
