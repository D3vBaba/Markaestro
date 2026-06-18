// Markaestro Connect API — helpers.
//
// The Connect API (routes under `app/api/connect/v1/`) is a flat, snake_case
// integration surface that lets external scheduling tools publish to a
// workspace's connected channels using a workspace API key. It is a thin
// translation layer over Markaestro's native public API: it accepts the common
// snake_case scheduling-client conventions and maps them onto Markaestro's
// products/destinations/posts model.
//
// To connect a client, point its API base at `<this-origin>/api/connect` and
// authenticate with a workspace API key (scopes: posts.read, posts.write,
// media.write).
//
// Surface:
//   GET  /v1/social-accounts        → connected, publishable destinations
//   POST /v1/media/create-upload-url → mint a signed, single-use PUT url
//   PUT  /v1/media/upload?token=…    → store bytes as a media_asset
//   POST /v1/posts                   → one post per selected destination
//   GET  /v1/posts                   → workspace posts in Connect shape
import crypto from 'crypto';
import type { SocialChannel } from '@/lib/schemas';
import {
  listPublicProducts,
  listPublicProductDestinations,
  resolvePublicPostDestination,
} from './products';

// Only these channels have working publish destinations in Markaestro today.
const CONNECT_CHANNELS: SocialChannel[] = ['facebook', 'instagram', 'tiktok'];

export type ConnectAccount = {
  // Opaque id a client round-trips as a "social account". Encodes the
  // Markaestro productId (optional) + destinationId so a created post can be
  // resolved back to the exact connected account.
  id: string;
  // The product this account belongs to. The same social account can appear
  // under multiple products — these fields let clients group and disambiguate.
  product_id: string | null;
  product: string | null;
  platform: SocialChannel;
  username: string;
};

export type ConnectProduct = {
  id: string;
  name: string;
  channels: SocialChannel[];
  accounts: ConnectAccount[];
};

// ── Account id <-> destination encoding ──────────────────────────────────────
// Token shape: `${productId}#${destinationId}` (product-scoped) or
// `${destinationId}` (workspace-level). destinationId is `provider:channel:acct`
// and never contains `#`, so a single split is unambiguous.
export function encodeAccountId(productId: string | undefined, destinationId: string): string {
  return productId ? `${productId}#${destinationId}` : destinationId;
}

export function parseAccountId(token: string): {
  productId?: string;
  destinationId: string;
  channel: SocialChannel;
} {
  const hash = token.indexOf('#');
  const productId = hash >= 0 ? token.slice(0, hash) : undefined;
  const destinationId = hash >= 0 ? token.slice(hash + 1) : token;
  const channel = destinationId.split(':')[1] as SocialChannel;
  return { productId, destinationId, channel };
}

// List every connected, publishable destination for a workspace, deduped.
// When `boundProductId` is set (a product-bound key), only that product's
// accounts are returned and the workspace-level fallback is skipped.
export async function listConnectedAccounts(
  workspaceId: string,
  boundProductId?: string,
): Promise<ConnectAccount[]> {
  const byToken = new Map<string, ConnectAccount>();

  // Product-scoped destinations (the primary Markaestro model).
  const products = await listPublicProducts(workspaceId);
  for (const product of products) {
    if (boundProductId && product.id !== boundProductId) continue;
    const destinations = await listPublicProductDestinations(workspaceId, product.id);
    for (const d of destinations) {
      const token = encodeAccountId(product.id, d.id);
      byToken.set(token, {
        id: token,
        product_id: product.id,
        product: product.name,
        platform: d.channel,
        username: d.username || d.displayName || d.channel,
      });
    }
  }

  // Workspace-level single-destination fallback (no product configured).
  // resolvePublicPostDestination only succeeds when exactly one exists.
  // Skipped for product-bound keys (those are product-scoped by definition).
  if (!boundProductId) {
    for (const channel of CONNECT_CHANNELS) {
      try {
        const resolved = await resolvePublicPostDestination(workspaceId, channel);
        if (resolved?.destinationId && !byToken.has(resolved.destinationId)) {
          byToken.set(resolved.destinationId, {
            id: resolved.destinationId,
            product_id: resolved.productId || null,
            product: null,
            platform: channel,
            username: channel,
          });
        }
      } catch {
        // 0 or >1 workspace-level destinations for this channel — skip.
      }
    }
  }

  return [...byToken.values()];
}

// List products with their connected accounts nested — a product-first picker
// for clients that want to scope by product. Honors a product-bound key.
export async function listConnectProducts(
  workspaceId: string,
  boundProductId?: string,
): Promise<ConnectProduct[]> {
  const accounts = await listConnectedAccounts(workspaceId, boundProductId);
  const products = await listPublicProducts(workspaceId);
  return products
    .filter((p) => !boundProductId || p.id === boundProductId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      channels: p.availableChannels,
      accounts: accounts.filter((a) => a.product_id === p.id),
    }));
}

// ── Post status mapping ──────────────────────────────────────────────────────
// Native statuses → the flat set Connect clients expect on a post:
// scheduled | processing | posted | draft | failed.
export function mapPostStatus(status: unknown): string {
  switch (status) {
    case 'published':
      return 'posted';
    case 'publishing':
      return 'processing';
    case 'scheduled':
      return 'scheduled';
    case 'failed':
      return 'failed';
    case 'platform_action_required':
    case 'exported_for_review':
    case 'draft':
    default:
      return 'draft';
  }
}

// ── Signed upload tokens (presigned-URL equivalent) ──────────────────────────
// A create-upload-url call mints a short-lived HMAC token bound to one assetId.
// The PUT handler verifies it — no API key travels with the raw byte upload,
// exactly like an S3-style presigned URL.
type UploadTokenPayload = {
  ws: string;
  assetId: string;
  mime: string;
  exp: number; // epoch ms
};

function signingSecret(): string {
  const raw =
    process.env.WORKER_SECRET ||
    process.env.DATA_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    '';
  if (!raw) {
    throw new Error('CONNECT_UPLOAD_SECRET_MISSING');
  }
  return raw;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function hmac(data: string): string {
  return b64url(crypto.createHmac('sha256', signingSecret()).update(data).digest());
}

const UPLOAD_TTL_MS = 15 * 60 * 1000;

export function signUploadToken(p: Omit<UploadTokenPayload, 'exp'>): string {
  const payload: UploadTokenPayload = { ...p, exp: Date.now() + UPLOAD_TTL_MS };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

export function verifyUploadToken(token: string | null): UploadTokenPayload {
  if (!token) throw new Error('UNAUTHENTICATED');
  const dot = token.lastIndexOf('.');
  if (dot <= 0) throw new Error('UNAUTHENTICATED');
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  // Constant-time-ish compare via length + timingSafeEqual.
  const expected = hmac(body);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    throw new Error('UNAUTHENTICATED');
  }
  let payload: UploadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    throw new Error('UNAUTHENTICATED');
  }
  if (!payload?.exp || payload.exp < Date.now()) throw new Error('UNAUTHENTICATED');
  return payload;
}

// Build the origin (scheme + host) of the incoming request, honoring proxies.
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  return `${proto}://${host}`;
}
