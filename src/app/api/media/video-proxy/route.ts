import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Keep the proxy aligned with Public API video uploads so TikTok can fetch the
// same assets we accept from API clients without a hidden size mismatch.
const MAX_PROXY_VIDEO_BYTES = 500 * 1024 * 1024;
const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm'];
const SUPPORTED_VIDEO_CONTENT_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

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
  const normalizedType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (SUPPORTED_VIDEO_CONTENT_TYPES.has(normalizedType)) return true;
  if (normalizedType === 'application/octet-stream') {
    const lowerPath = pathname.toLowerCase();
    return SUPPORTED_VIDEO_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
  }
  return false;
}

function inferVideoContentType(contentType: string, pathname: string): string {
  const normalizedType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (SUPPORTED_VIDEO_CONTENT_TYPES.has(normalizedType)) return contentType;

  const lowerPath = pathname.toLowerCase();
  if (lowerPath.endsWith('.mov')) return 'video/quicktime';
  if (lowerPath.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

function parseContentRangeTotal(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function buildProxyHeaders(upstream: Response, contentType: string): Headers {
  const headers = new Headers();
  const passthroughHeaders = [
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ];

  headers.set('Content-Type', contentType);
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
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  // The bucket allowlist below is the real authorization. assertSafeOutboundUrl
  // does a DNS lookup on every request for SSRF protection, but our allowed
  // hosts are all Google-managed public domains, so the lookup is redundant
  // and adds latency to every TikTok PULL_FROM_URL fetch.
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
  const responseContentType = inferVideoContentType(contentType, parsed.pathname);

  const contentLength = Number(upstream.headers.get('content-length') || '0');
  const totalLength = parseContentRangeTotal(upstream.headers.get('content-range')) || contentLength;
  if (totalLength > MAX_PROXY_VIDEO_BYTES) {
    return NextResponse.json({ error: 'Remote video too large' }, { status: 413 });
  }

  return new NextResponse(method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: buildProxyHeaders(upstream, responseContentType),
  });
}

export async function GET(req: NextRequest) {
  return proxyVideo(req, 'GET');
}

export async function HEAD(req: NextRequest) {
  return proxyVideo(req, 'HEAD');
}
