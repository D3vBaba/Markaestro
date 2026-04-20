import { adminDb } from '@/lib/firebase-admin';
import { safeCompare } from '@/lib/crypto';
import { RATE_LIMITS, checkRateLimit, type RateLimitConfig } from '@/lib/rate-limit';
import { parseApiKey, hashSecret } from './keys';
import type { PublicApiScope } from './scopes';
import { incrementApiClientStat } from './analytics';

export type PublicApiContext = {
  principalType: 'api_client';
  workspaceId: string;
  clientId: string;
  ownerUid?: string;
  scopes: PublicApiScope[];
  rateLimitHeaders: Record<string, string>;
};

type RequirePublicApiContextOptions = {
  scope?: PublicApiScope;
  rateLimit?: RateLimitConfig;
};

const impliedScopeGrants: Partial<Record<PublicApiScope, PublicApiScope[]>> = {
  'products.read': ['posts.write', 'posts.publish'],
};

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

function headersFromResult(result: Awaited<ReturnType<typeof checkRateLimit>>) {
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

export async function requirePublicApiContext(
  req: Request,
  options: RequirePublicApiContextOptions = {},
): Promise<PublicApiContext> {
  const token = getBearerToken(req);
  if (!token) throw new Error('UNAUTHENTICATED');

  const parsed = parseApiKey(token);
  if (!parsed) throw new Error('UNAUTHENTICATED');

  const ref = adminDb.doc(`workspaces/${parsed.workspaceId}/api_clients/${parsed.clientId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('UNAUTHENTICATED');

  const data = snap.data() as {
    ownerUid?: string;
    scopes?: string[];
    status?: string;
    secretHash?: string;
  };

  if (data.status !== 'active' || !data.secretHash || !safeCompare(data.secretHash, hashSecret(parsed.secret))) {
    throw new Error('UNAUTHENTICATED');
  }

  const scopes = (data.scopes || []) as PublicApiScope[];
  if (options.scope && !hasPublicApiScope(scopes, options.scope)) {
    throw new Error('FORBIDDEN');
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
  const [globalResult, pathResult] = await Promise.all([
    checkRateLimit(`public-api:${parsed.clientId}`, globalConfig),
    checkRateLimit(`public-api:${parsed.clientId}:${pathname}`, rateLimitConfig),
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

  await ref.set({ lastUsedAt: new Date().toISOString() }, { merge: true });
  await incrementApiClientStat(parsed.workspaceId, parsed.clientId, 'request');

  return {
    principalType: 'api_client',
    workspaceId: parsed.workspaceId,
    clientId: parsed.clientId,
    ownerUid: data.ownerUid,
    scopes,
    rateLimitHeaders,
  };
}
