import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

/**
 * Proxies media from Firebase Storage through the app's domain.
 * TikTok's PULL_FROM_URL requires the image URL to be on a verified domain,
 * and only accepts JPEG/WEBP (not PNG). This route proxies the image and
 * converts PNG to JPEG automatically.
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
  const buffer = Buffer.from(await upstream.arrayBuffer());

  // TikTok rejects PNG — convert to JPEG
  if (contentType.includes('png')) {
    const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
    return new NextResponse(jpegBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(jpegBuffer.length),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
