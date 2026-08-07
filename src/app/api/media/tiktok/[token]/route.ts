import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import {
  assertSafeOutboundUrl,
  readResponseBufferWithLimit,
} from '@/lib/network-security';

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
 * TikTok-facing image proxy with an opaque, extension-terminated path.
 *
 * TikTok's PULL_FROM_URL fetcher failed consistently against the original
 * `/api/media/proxy?url=<encoded-url>` shape (`photo_pull_failed`) while the
 * same route returned a valid JPEG to every client we tested, including
 * ByteSpider. Two properties of that URL are known trip-wires for TikTok's
 * puller: a nested URL inside a query parameter, which URL normalization can
 * mangle before the fetch, and the absence of an image file extension on the
 * path. This route removes both — the storage URL travels base64url-encoded in
 * the path, terminated by `.jpg`, with no query string at all.
 *
 * GET /api/media/tiktok/<base64url(mediaUrl)>.jpg
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const encoded = token.endsWith('.jpg') ? token.slice(0, -4) : token;

  let rawUrl: string;
  try {
    rawUrl = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
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
