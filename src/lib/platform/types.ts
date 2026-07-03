import type { SocialChannel } from '@/lib/schemas';
import type { PublicDeliveryMode } from '@/lib/public-api/scopes';

// ── Capabilities ────────────────────────────────────────────────────

export const PlatformCapability = {
  PUBLISH_TEXT: 'publish_text',
  PUBLISH_IMAGE: 'publish_image',
  PUBLISH_VIDEO: 'publish_video',
  PUBLISH_CAROUSEL: 'publish_carousel',
} as const;

export type PlatformCapability = (typeof PlatformCapability)[keyof typeof PlatformCapability];

export const ConnectionStatus = {
  CONNECTED: 'connected',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  ERROR: 'error',
} as const;

export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

// ── Platform Connection (Firestore model) ───────────────────────────

export type PlatformConnection = {
  /** OAuth provider key (meta, tiktok, etc.) */
  provider: string;
  /** Which channels this connection serves */
  channels: SocialChannel[];
  /** Capabilities this connection supports */
  capabilities: PlatformCapability[];
  /** Current status */
  status: ConnectionStatus;
  /** Encrypted access token */
  accessTokenEncrypted: string;
  /** Encrypted refresh token (if available) */
  refreshTokenEncrypted?: string;
  /** When the access token expires */
  tokenExpiresAt?: string;
  /** Provider-specific metadata (pageId, igAccountId, username, etc.) */
  metadata: Record<string, unknown>;
  /** Workspace that owns this connection */
  workspaceId: string;
  /** Product this connection is scoped to (if any) */
  productId?: string;
  /** Who last updated this connection */
  updatedBy: string;
  updatedAt: string;
  createdAt: string;
};

// ── Publish types ───────────────────────────────────────────────────

export type PublishRequest = {
  content: string;
  channel: SocialChannel;
  mediaUrls?: string[];
  deliveryMode?: PublicDeliveryMode;
  destinationProvider?: string;
  destinationId?: string;
  /**
   * For TikTok photo carousels: which image (0-based) is the cover.
   * Defaults to 0 if not set. Maps to TikTok's `photo_cover_index`.
   * Populated from `slideshowCoverIndex` on posts (e.g. legacy carousel exports)
   * or from `settings.photoCoverIndex` when the post was created with typed
   * TikTok settings via the public API.
   */
  photoCoverIndex?: number;
  /**
   * Platform-specific settings carried verbatim from the post (public API
   * `settings` field, discriminated by `__type`). Each adapter narrows this
   * with its own type guard from `@/lib/public-api/post-settings`.
   */
  settings?: Record<string, unknown>;
};

export type PublishResult = {
  success: boolean;
  pending?: boolean;
  externalId?: string;
  externalUrl?: string;
  nextAction?: string;
  error?: string;
};

// ── Metrics types ───────────────────────────────────────────────────

/**
 * Post-level metrics normalized across platforms. A metric a platform does
 * not expose is `null` — never a fabricated zero. Platform-specific extras
 * (with their verbatim API metric names) go in `raw`.
 *
 * `views` is the canonical view/impression count: Meta deprecated the
 * `impressions` family across 2024–2026 in favor of views-style metrics,
 * and every other platform reports a views-like counter.
 */
export type NormalizedPostMetrics = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  videoViews: number | null;
  raw: Record<string, number>;
};

export type MetricsFetchInput = {
  channel: SocialChannel;
  /** Platform post/media ID recorded at publish time. */
  externalId: string;
  /** ISO timestamp the post went live (bounds date-ranged analytics APIs). */
  publishedAt?: string;
  /** LinkedIn destination the post was published to (profile vs page). */
  destinationId?: string;
};

/**
 * `reason` drives the poller's state machine:
 * - auth: token invalid/revoked → surface on the connection, retry later
 * - not_found: post deleted on the platform → stop polling
 * - unsupported: platform/account can't provide metrics → stop polling
 * - transient: network/rate-limit/5xx → retry with backoff
 */
export type MetricsFetchResult =
  | { ok: true; metrics: NormalizedPostMetrics }
  | { ok: false; error: string; reason: 'auth' | 'not_found' | 'unsupported' | 'transient' };

export type AudienceFetchResult =
  | { ok: true; followers: number; raw?: Record<string, number> }
  | { ok: false; error: string; reason: 'auth' | 'not_found' | 'unsupported' | 'transient' };

// ── Platform post management (list / delete) ────────────────────────

/**
 * A post as it exists on the platform right now, fetched live from the
 * platform's API (not from our Firestore records). Fields a platform does
 * not return are `null`.
 */
export type PlatformPostSummary = {
  /** Platform post/media ID (Graph media ID, LinkedIn URN, pin ID, …). */
  externalId: string;
  channel: SocialChannel;
  /** Post text/caption. */
  content: string | null;
  mediaType: 'text' | 'image' | 'video' | 'carousel' | 'unknown';
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  /** ISO timestamp the post went live. */
  publishedAt: string | null;
  /**
   * Whether the platform's API supports deleting this post. False where the
   * platform has no delete endpoint (Instagram media, TikTok videos).
   */
  canDelete: boolean;
};

export type ListPostsInput = {
  channel: SocialChannel;
  /** Opaque pagination cursor returned as `nextCursor` by a previous page. */
  cursor?: string;
  /** Max posts per page; adapters clamp to platform limits. */
  limit?: number;
  /** LinkedIn destination to list from (profile vs page). */
  destinationId?: string;
};

export type ListPostsResult =
  | { ok: true; posts: PlatformPostSummary[]; nextCursor?: string }
  | { ok: false; error: string; reason: 'auth' | 'unsupported' | 'transient' };

export type DeletePostInput = {
  channel: SocialChannel;
  /** Platform post/media ID to delete. */
  externalId: string;
  /** LinkedIn destination the post belongs to (profile vs page). */
  destinationId?: string;
};

/** `reason` semantics match MetricsFetchResult. */
export type DeletePostResult =
  | { ok: true }
  | { ok: false; error: string; reason: 'auth' | 'not_found' | 'unsupported' | 'transient' };

// ── Platform Adapter Interface ──────────────────────────────────────

export interface PlatformAdapter {
  /** Unique adapter ID, e.g. 'meta-publishing', 'tiktok-publishing' */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Which channels this adapter handles */
  readonly channels: SocialChannel[];
  /** What this adapter can do */
  readonly capabilities: PlatformCapability[];

  /** Publish content to the platform */
  publish(connection: PlatformConnection, request: PublishRequest): Promise<PublishResult>;

  /** Test the connection (e.g. fetch user profile) */
  testConnection(connection: PlatformConnection): Promise<{ ok: boolean; label?: string; error?: string }>;

  /** Validate that the connection has the required metadata for a given channel */
  validateConnection(connection: PlatformConnection, channel: SocialChannel): string | null;

  /** Fetch post-level insights for a published post (optional per adapter) */
  fetchMetrics?(connection: PlatformConnection, input: MetricsFetchInput): Promise<MetricsFetchResult>;

  /** Fetch the current follower/audience count for a channel (optional per adapter) */
  fetchAudience?(connection: PlatformConnection, channel: SocialChannel): Promise<AudienceFetchResult>;

  /** List the account's published posts live from the platform (optional per adapter) */
  listPosts?(connection: PlatformConnection, input: ListPostsInput): Promise<ListPostsResult>;

  /** Delete a post on the platform (optional per adapter) */
  deletePost?(connection: PlatformConnection, input: DeletePostInput): Promise<DeletePostResult>;
}
