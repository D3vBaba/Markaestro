import { adminDb } from '@/lib/firebase-admin';
import { safeCompare } from '@/lib/crypto';
import { RATE_LIMITS, checkRateLimits, type RateLimitConfig, type RateLimitResult } from '@/lib/rate-limit';
import { getEffectiveSubscription, isActiveSubscription } from '@/lib/stripe/subscription';
import { parseApiKey, hashSecret } from './keys';
import type { PublicApiScope } from './scopes';
import { incrementApiClientStat } from './usage';

export type PublicApiContext = {
  principalType: 'api_client';
  workspaceId: string;
  clientId: string;
  ownerUid?: string;
  scopes: PublicApiScope[];
  // Every authenticated key is bound to exactly one product: calls auto-target
  // it and requests for any other product are rejected. Unbound keys are
  // refused at authentication, so this is always set.
  productId: string;
  rateLimitHeaders: Record<string, string>;
};

type RequirePublicApiContextOptions = {
  scope?: PublicApiScope;
  rateLimit?: RateLimitConfig;
};

type ApiClientAuthData = {
  ownerUid?: string;
  scopes?: string[];
  status?: string;
  secretHash?: string;
  expiresAt?: string | null;
  productId?: string | null;
};

const AUTH_CACHE_TTL_MS = Math.max(0, Number(process.env.PUBLIC_API_AUTH_CACHE_TTL_MS || 15_000));
const AUTH_CACHE_MAX_ENTRIES = 1_000;
const apiClientAuthCache = new Map<string, { data: ApiClientAuthData; expiresAt: number }>();
const membershipCache = new Map<string, { exists: boolean; expiresAt: number }>();

function cachedValue<T>(cache: Map<string, { data: T; expiresAt: number }>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function putCachedValue<T>(cache: Map<string, { data: T; expiresAt: number }>, key: string, data: T) {
  if (AUTH_CACHE_TTL_MS === 0) return;
  if (cache.size >= AUTH_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { data, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
}

async function loadApiClientAuthData(path: string): Promise<ApiClientAuthData | null> {
  const cached = cachedValue(apiClientAuthCache, path);
  if (cached) return cached;
  const snap = await adminDb.doc(path).get();
  if (!snap.exists) return null;
  const data = snap.data() as ApiClientAuthData;
  putCachedValue(apiClientAuthCache, path, data);
  return data;
}

async function membershipStillExists(workspaceId: string, uid: string): Promise<boolean> {
  const key = `${workspaceId}:${uid}`;
  const entry = membershipCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.exists;
  if (entry) membershipCache.delete(key);
  const snap = await adminDb.doc(`workspaces/${workspaceId}/members/${uid}`).get();
  const exists = snap.exists;
  if (AUTH_CACHE_TTL_MS > 0) {
    if (membershipCache.size >= AUTH_CACHE_MAX_ENTRIES) {
      membershipCache.delete(membershipCache.keys().next().value as string);
    }
    membershipCache.set(key, { exists, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  }
  return exists;
}

const impliedScopeGrants: Partial<Record<PublicApiScope, PublicApiScope[]>> = {
  'products.read': ['posts.write', 'posts.publish'],
};

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

function headersFromResult(result: RateLimitResult) {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
}

export function hasPublicApiScope(
  grantedScopes: readonly PublicApiScope[],
  requiredScope: PublicApiScope,
): boolean {
  if (grantedScopes.includes(requiredScope)) return true;
  const impliedBy = impliedScopeGrants[requiredScope] || [];
  return impliedBy.some((scope) => grantedScopes.includes(scope));
}

/**
 * Every API key is bound to exactly one product — the binding is what scopes a
 * key to a single brand. Keys minted before that requirement carry no
 * productId and would otherwise authenticate workspace-wide, so they are
 * refused rather than silently granted access across every brand.
 *
 * Returns the bound product id so callers get a non-optional value.
 */
export function requireApiClientProduct(productId: string | null | undefined): string {
  const bound = typeof productId === 'string' ? productId.trim() : '';
  if (!bound) {
    throw new Response(JSON.stringify({
      error: 'API_KEY_NOT_BOUND_TO_PRODUCT',
      message: 'This API key is not bound to a brand. Create a new key in Settings → API, which binds it to one brand.',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  return bound;
}

export async function requirePublicApiContext(
  req: Request,
  options: RequirePublicApiContextOptions = {},
): Promise<PublicApiContext> {
  const token = getBearerToken(req);
  if (!token) throw new Error('UNAUTHENTICATED');

  const parsed = parseApiKey(token);
  if (!parsed) throw new Error('UNAUTHENTICATED');

  const clientPath = `workspaces/${parsed.workspaceId}/api_clients/${parsed.clientId}`;
  const data = await loadApiClientAuthData(clientPath);
  if (!data) throw new Error('UNAUTHENTICATED');

  if (data.status !== 'active' || !data.secretHash || !safeCompare(data.secretHash, hashSecret(parsed.secret))) {
    throw new Error('UNAUTHENTICATED');
  }

  // Expired keys behave exactly like revoked ones (legacy docs without
  // expiresAt never expire). An unparseable expiresAt fails closed.
  if (data.expiresAt) {
    const expiresAtMs = new Date(data.expiresAt).getTime();
    if (Number.isNaN(expiresAtMs) || expiresAtMs < Date.now()) {
      throw new Error('UNAUTHENTICATED');
    }
  }

  // A key's authority derives from its creator's membership. If that person
  // left or was removed, the key dies with the membership — removal also
  // revokes keys eagerly (lib/team-members), but this re-check covers keys
  // that predate that cleanup or slipped past it.
  if (data.ownerUid) {
    if (!await membershipStillExists(parsed.workspaceId, data.ownerUid)) {
      throw new Error('UNAUTHENTICATED');
    }
  }

  const scopes = (data.scopes || []) as PublicApiScope[];
  if (options.scope && !hasPublicApiScope(scopes, options.scope)) {
    throw new Error('FORBIDDEN');
  }

  const productId = requireApiClientProduct(data.productId);

  // The key's workspace must actually be entitled to the public API.
  // Key revocation only fires on Stripe cancellation events, which a
  // never-subscribed workspace never receives — so without this check its
  // keys would keep working forever. Resolved through the key owner's
  // effective subscription so comped accounts (accountEntitlements) keep
  // API access, and placed before the rate-limit/stat side effects so
  // refused calls leave none.
  const subscription = await getEffectiveSubscription({
    uid: data.ownerUid || undefined,
    workspaceId: parsed.workspaceId,
  });
  if (!isActiveSubscription(subscription)) {
    throw new Response(JSON.stringify({
      error: 'SUBSCRIPTION_REQUIRED',
      message: 'This workspace has no active subscription. The public API requires an active plan.',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const rateLimitConfig = options.rateLimit || RATE_LIMITS.api;
  const pathname = new URL(req.url).pathname;

  // Two-layer rate limit:
  //   1. Global per-client budget: a generous ceiling so a single client
  //      can't saturate shared Cloud Run instances by hammering across
  //      many endpoints in parallel (path-scoped limits don't stack).
  //   2. Per-path budget: the sensitive/expensive routes (AI, publish)
  //      pick their own via `options.rateLimit`.
  const globalConfig: RateLimitConfig = {
    limit: Math.max(rateLimitConfig.limit * 4, 240),
    windowMs: rateLimitConfig.windowMs,
  };
  const [globalResult, pathResult] = await checkRateLimits([
    { key: `public-api:${parsed.clientId}`, config: globalConfig },
    { key: `public-api:${parsed.clientId}:${pathname}`, config: rateLimitConfig },
  ]);

  const effective = !globalResult.allowed ? globalResult : pathResult;
  const rateLimitHeaders = headersFromResult(effective);

  if (!effective.allowed) {
    const retryAfter = Math.max(1, Math.ceil((effective.resetAt - Date.now()) / 1000));
    throw new Response(JSON.stringify({ error: 'RATE_LIMITED', retryAfter }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
        ...rateLimitHeaders,
      },
    });
  }

  await incrementApiClientStat(parsed.workspaceId, parsed.clientId, 'request');

  return {
    principalType: 'api_client',
    workspaceId: parsed.workspaceId,
    clientId: parsed.clientId,
    ownerUid: data.ownerUid,
    scopes,
    productId,
    rateLimitHeaders,
  };
}
