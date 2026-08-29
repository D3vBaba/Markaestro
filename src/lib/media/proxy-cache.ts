/**
 * Deterministic cache for the image proxies' transform output.
 *
 * `/api/media/proxy` and `/api/media/tiktok/[token]` run a sharp decode,
 * rotate, resize, flatten, and mozjpeg encode on up to 20 MB, unauthenticated.
 * The transform is a pure function of the source URL, so the second request for
 * a given URL never needs to run it again. Caching removes almost all of the
 * CPU amplification these routes otherwise offer, and it is a straight latency
 * win for the platform fetchers that are the legitimate callers.
 *
 * The cache object's Firebase download token is derived from the source URL
 * rather than random, so the public URL for a cached entry is reproducible
 * without a second lookup or a Firestore record.
 */

import crypto from 'crypto';
import { buildDownloadUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';

const CACHE_PREFIX = 'mediaProxyCache';
/** Cached transforms are disposable; a stale entry only costs one re-encode. */
const CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function cacheSecret(): string {
  return (
    process.env.WORKER_SECRET ||
    process.env.DATA_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    ''
  );
}

/** Stable identity for one source URL plus transform version. */
export function proxyCacheKey(sourceUrl: string): string {
  return crypto.createHash('sha256').update(`media-proxy-cache:v1:${sourceUrl}`).digest('hex');
}

function cachePath(key: string): string {
  return `${CACHE_PREFIX}/${key}.jpg`;
}

/**
 * The download token for a cache entry, derived so the public URL can be
 * rebuilt from the source URL alone. Returns null without a secret, which
 * disables the cache rather than falling back to a guessable token.
 */
function cacheDownloadToken(key: string): string | null {
  const secret = cacheSecret();
  if (!secret) return null;
  const digest = crypto.createHmac('sha256', secret).update(`media-proxy-token:${key}`).digest('hex');
  // Shaped like the UUID Firebase mints itself, which keeps the URL familiar.
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
}

export type ProxyCacheHit = { url: string; download: () => Promise<Buffer> };

/**
 * Look up a cached transform. Returns null on a miss and, deliberately, also on
 * any storage error: a cache that fails must degrade to a re-encode, never to a
 * failed image.
 */
export async function readProxyCache(sourceUrl: string): Promise<ProxyCacheHit | null> {
  const key = proxyCacheKey(sourceUrl);
  const token = cacheDownloadToken(key);
  if (!token) return null;

  try {
    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();
    const file = bucket.file(cachePath(key));
    const [exists] = await file.exists();
    if (!exists) return null;
    return {
      url: buildDownloadUrl(bucket.name, cachePath(key), token),
      download: async () => (await file.download())[0],
    };
  } catch (error) {
    logger.warn('Media proxy cache read failed', {
      event: 'media.proxy_cache_read_failed',
      err: error,
    });
    return null;
  }
}

/**
 * Store a transform result. Best effort: a failed write is logged and swallowed
 * so the request that produced the bytes still returns them.
 */
export async function writeProxyCache(sourceUrl: string, jpeg: Buffer): Promise<string | null> {
  const key = proxyCacheKey(sourceUrl);
  const token = cacheDownloadToken(key);
  if (!token) return null;

  try {
    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();
    await bucket.file(cachePath(key)).save(jpeg, {
      resumable: false,
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    return buildDownloadUrl(bucket.name, cachePath(key), token);
  } catch (error) {
    logger.warn('Media proxy cache write failed', {
      event: 'media.proxy_cache_write_failed',
      err: error,
    });
    return null;
  }
}
