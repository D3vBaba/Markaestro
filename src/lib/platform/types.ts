import type { SocialChannel } from '@/lib/schemas';

// ── Capabilities ────────────────────────────────────────────────────

export const PlatformCapability = {
  PUBLISH_TEXT: 'publish_text',
  PUBLISH_IMAGE: 'publish_image',
  PUBLISH_VIDEO: 'publish_video',
  PUBLISH_CAROUSEL: 'publish_carousel',
  ANALYTICS: 'analytics',
  ADS: 'ads',
  EMAIL: 'email',
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
  /** OAuth provider key (meta, x, tiktok, google) */
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
};

export type PublishResult = {
  success: boolean;
  externalId?: string;
  externalUrl?: string;
  error?: string;
};

// ── Platform Adapter Interface ──────────────────────────────────────

export interface PlatformAdapter {
  /** Unique adapter ID, e.g. 'x-publishing', 'meta-publishing' */
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
}
