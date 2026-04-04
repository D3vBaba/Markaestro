import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import {
  assertSafeOutboundUrl,
  readResponseBufferWithLimit,
} from '@/lib/network-security';

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
 */
export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url');
  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = await assertSafeOutboundUrl(rawUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  if (!isAllowedStorageUrl(parsed)) {
    return NextResponse.json({ error: 'URL host not allowed' }, { status: 403 });
  }

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

  return new NextResponse(new Uint8Array(jpegBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(jpegBuffer.length),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
