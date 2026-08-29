/**
 * Signed tokens for the public media proxies.
 *
 * `/api/media/proxy`, `/api/media/video-proxy`, and `/api/media/tiktok/[token]`
 * are unauthenticated by necessity: TikTok's `PULL_FROM_URL` fetches them
 * directly, so a session cookie is not available. That does not have to mean
 * unmetered. A token minted at publish time proves the URL came from us, which
 * closes the endpoints to anyone who merely observed or guessed a storage URL.
 *
 * Rollout is deliberately two-step, because the platforms hold these URLs for
 * as long as a pull takes and a scheduled publish can hand one over hours
 * before it is fetched:
 *
 *   1. Mint and accept. Tokens ride on the URL and verify when present;
 *      unsigned requests are still served (and counted), so an in-flight pull
 *      minted by the previous release does not fail.
 *   2. Require. Set `MEDIA_PROXY_REQUIRE_TOKEN=1` once the logs show no
 *      unsigned hits from platform fetchers. Unsigned requests then 403.
 *
 * Per-IP rate limits (`RATE_LIMITS.mediaProxy`) apply in both steps and are the
 * control that bounds abuse today.
 */

import crypto from 'crypto';
import { logger } from '@/lib/logger';

/** How long a minted proxy token stays valid. */
export const MEDIA_PROXY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type MediaProxyKind = 'image' | 'video';

function signingSecret(): string {
  const raw =
    process.env.WORKER_SECRET ||
    process.env.DATA_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    '';
  if (!raw) throw new Error('MEDIA_PROXY_SECRET_MISSING');
  return raw;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

/** Whether an unsigned proxy request should be refused rather than logged. */
export function mediaProxyTokenRequired(): boolean {
  return process.env.MEDIA_PROXY_REQUIRE_TOKEN === '1';
}

/**
 * Mint a token binding one media URL and kind to an expiry. Returns null when
 * no signing secret is configured, so local development without secrets keeps
 * working (verification treats a missing token as unsigned, not as invalid).
 */
export function mintMediaProxyToken(mediaUrl: string, kind: MediaProxyKind): string | null {
  let secretAvailable = true;
  try {
    signingSecret();
  } catch {
    secretAvailable = false;
  }
  if (!secretAvailable) return null;

  const exp = Date.now() + MEDIA_PROXY_TOKEN_TTL_MS;
  return `${exp}.${sign(`media-proxy:v1:${kind}:${mediaUrl}:${exp}`)}`;
}

export type MediaProxyTokenVerdict =
  | { state: 'valid' }
  | { state: 'absent' }
  | { state: 'invalid'; reason: 'malformed' | 'expired' | 'signature' | 'unconfigured' };

/** Verify a token against the URL and kind it was minted for. */
export function verifyMediaProxyToken(
  token: string | null | undefined,
  mediaUrl: string,
  kind: MediaProxyKind,
): MediaProxyTokenVerdict {
  if (!token) return { state: 'absent' };

  const separator = token.indexOf('.');
  if (separator <= 0) return { state: 'invalid', reason: 'malformed' };
  const exp = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isFinite(exp) || !signature) return { state: 'invalid', reason: 'malformed' };
  if (exp <= Date.now()) return { state: 'invalid', reason: 'expired' };

  let expected: string;
  try {
    expected = sign(`media-proxy:v1:${kind}:${mediaUrl}:${exp}`);
  } catch {
    return { state: 'invalid', reason: 'unconfigured' };
  }

  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) {
    return { state: 'invalid', reason: 'signature' };
  }
  return { state: 'valid' };
}

/**
 * Apply the proxy token policy for one request. Returns `null` when the request
 * may proceed and a `Response` when it must not. During the accept-and-log
 * phase every unsigned or bad-signature hit is logged with its route, which is
 * the signal that says whether enforcement can safely be turned on.
 */
export function enforceMediaProxyToken(input: {
  token: string | null | undefined;
  mediaUrl: string;
  kind: MediaProxyKind;
  route: string;
}): Response | null {
  const verdict = verifyMediaProxyToken(input.token, input.mediaUrl, input.kind);
  if (verdict.state === 'valid') return null;

  const required = mediaProxyTokenRequired();
  logger.warn('Media proxy request was not signed', {
    event: 'media.proxy_unsigned_request',
    route: input.route,
    kind: input.kind,
    verdict: verdict.state,
    reason: verdict.state === 'invalid' ? verdict.reason : undefined,
    enforced: required,
  });
  if (!required) return null;

  return Response.json({ error: 'MEDIA_PROXY_TOKEN_REQUIRED' }, { status: 403 });
}
