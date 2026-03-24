import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxies media from Firebase Storage (or any URL) through the app's domain.
 * TikTok's PULL_FROM_URL requires the image URL to be on a verified domain.
 * This route lets us serve images as https://markaestro.com/api/media/proxy?url=...
 *
 * GET /api/media/proxy?url=<encoded-url>
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Only allow proxying from our own Firebase Storage bucket
  const allowed = [
    'firebasestorage.googleapis.com',
    'storage.googleapis.com',
    'markaestro-0226220726.firebasestorage.app',
  ];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  if (!allowed.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
    return NextResponse.json({ error: 'URL host not allowed' }, { status: 403 });
  }

  const upstream = await fetch(url);
  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const contentLength = upstream.headers.get('content-length');
  const body = upstream.body;

  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
  });
  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }

  return new NextResponse(body, { status: 200, headers });
}
