import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import {
  assertSafeOutboundUrl,
  readResponseBufferWithLimit,
} from '@/lib/network-security';
import { apiError } from '@/lib/api-response';
import { RATE_LIMITS, applyRateLimit } from '@/lib/rate-limit';
import { readProxyCache, writeProxyCache } from '@/lib/media/proxy-cache';
import { enforceMediaProxyToken } from '@/lib/media/proxy-tokens';

export const runtime = 'nodejs';

const MAX_PROXY_BYTES = 20 * 1024 * 1024;
const TIKTOK_MAX_IMAGE_WIDTH = 1080;
const TIKTOK_MAX_IMAGE_HEIGHT = 1920;
const TIKTOK_JPEG_QUALITY = 90;

function isAllowedStorageUrl(url: URL): boolean {
  const bucket = (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim();
  if (!bucket) return false;

  const host = url.hostname.toLowerCase();

  if (host === bucket.toLowerCase()) {
    return true;
  }

  if (host === 'storage.googleapis.com') {
    const [bucketName] = url.pathname.replace(/^\/+/, '').split('/');
    return bucketName === bucket;
  }

  if (host === 'firebasestorage.googleapis.com') {
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\//);
    return match?.[1] === bucket;
  }

  return false;
}

/**
 * Proxies media from Firebase Storage through the app's domain.
 * TikTok's PULL_FROM_URL requires the image URL to be on a verified domain,
 * and photo uploads are capped at 1080p. This route normalizes every image to
 * a safe JPEG payload so TikTok's size checks pass consistently.
 *
 * GET /api/media/proxy?url=<encoded-url>
 *
 * The body below used to run outside any `try`. An upstream fetch rejection, a
 * `readResponseBufferWithLimit` overflow, or a `sharp` decode failure on a
 * corrupt image escaped as a framework 500: no requestId, no apiError shape,
 * and a body the client could not parse. A failed proxy is a failed image, so
 * there is no better degradation than saying so in the standard shape.
 */
export async function GET(req: NextRequest) {
  try {
    return await proxyImage(req);
  } catch (error) {
    // applyRateLimit signals a 429 by throwing the Response it wants returned.
    if (error instanceof Response) return error;
    return apiError(error);
  }
}

async function proxyImage(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url');
  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Metered before any work: the decode-resize-encode below is the expensive
  // part and this route needs no credentials to reach.
  await applyRateLimit(req, RATE_LIMITS.mediaProxy);

  let parsed: URL;
  try {
    parsed = await assertSafeOutboundUrl(rawUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  if (!isAllowedStorageUrl(parsed)) {
    return NextResponse.json({ error: 'URL host not allowed' }, { status: 403 });
  }

  const refusal = enforceMediaProxyToken({
    token: req.nextUrl.searchParams.get('t'),
    mediaUrl: rawUrl,
    kind: 'image',
    route: '/api/media/proxy',
  });
  if (refusal) return refusal;

  // The transform is a pure function of the source URL, so a repeat hit costs
  // a redirect instead of a sharp pipeline. Unlike the TikTok-facing route
  // below, this one has no fetcher known to mishandle a 302.
  const cached = await readProxyCache(rawUrl);
  if (cached) return NextResponse.redirect(cached.url, 302);

  const upstream = await fetch(parsed.toString(), {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.startsWith('image/') || contentType.includes('svg') || contentType.includes('xml')) {
    return NextResponse.json({ error: 'Unsupported media type' }, { status: 415 });
  }

  const buffer = await readResponseBufferWithLimit(upstream, MAX_PROXY_BYTES);

  const jpegBuffer = await sharp(buffer)
    .rotate()
    .resize({
      width: TIKTOK_MAX_IMAGE_WIDTH,
      height: TIKTOK_MAX_IMAGE_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({
      quality: TIKTOK_JPEG_QUALITY,
      mozjpeg: true,
    })
    .toBuffer();

  // Best effort, and deliberately not awaited for its URL: the caller that
  // paid for the transform gets the bytes either way.
  await writeProxyCache(rawUrl, jpegBuffer);

  return new NextResponse(new Uint8Array(jpegBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(jpegBuffer.length),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
