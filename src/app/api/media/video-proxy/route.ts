import { NextRequest, NextResponse } from 'next/server';
import { assertSafeOutboundUrl } from '@/lib/network-security';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Keep the proxy aligned with Public API video uploads so TikTok can fetch the
// same assets we accept from API clients without a hidden size mismatch.
const MAX_PROXY_VIDEO_BYTES = 500 * 1024 * 1024;
const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi'];

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

function isSupportedVideo(contentType: string, pathname: string): boolean {
  if (contentType.startsWith('video/')) return true;
  if (contentType === 'application/octet-stream') {
    const lowerPath = pathname.toLowerCase();
    return SUPPORTED_VIDEO_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
  }
  return false;
}

function buildProxyHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const passthroughHeaders = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ];

  for (const name of passthroughHeaders) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  headers.set('Cache-Control', upstream.headers.get('cache-control') || 'public, max-age=3600');
  return headers;
}

async function proxyVideo(req: NextRequest, method: 'GET' | 'HEAD') {
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

  const upstreamHeaders = new Headers();
  const range = req.headers.get('range');
  if (range) upstreamHeaders.set('Range', range);

  const upstream = await fetch(parsed.toString(), {
    method,
    headers: upstreamHeaders,
    redirect: 'error',
    signal: AbortSignal.timeout(295_000),
  });
  if (!upstream.ok && upstream.status !== 206) {
    return new NextResponse(null, { status: upstream.status });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!isSupportedVideo(contentType, parsed.pathname)) {
    return NextResponse.json({ error: 'Unsupported media type' }, { status: 415 });
  }

  const contentLength = Number(upstream.headers.get('content-length') || '0');
  if (contentLength > MAX_PROXY_VIDEO_BYTES) {
    return NextResponse.json({ error: 'Remote video too large' }, { status: 413 });
  }

  return new NextResponse(method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: buildProxyHeaders(upstream),
  });
}

export async function GET(req: NextRequest) {
  return proxyVideo(req, 'GET');
}

export async function HEAD(req: NextRequest) {
  return proxyVideo(req, 'HEAD');
}
