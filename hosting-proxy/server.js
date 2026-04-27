import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PORT = Number(process.env.PORT || 8080);
const UPSTREAM = 'https://markaestro--markaestro-0226220726.us-central1.hosted.app';
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);
const RESPONSE_HEADER_ALLOWLIST = new Set([
  // Range / size — TikTok's PULL_FROM_URL downloader needs these to pre-size
  // and resume the stream; without them it falls back to a single linear read
  // and stalls in PROCESSING_DOWNLOAD on any TCP hiccup.
  'accept-ranges',
  'content-length',
  'content-range',
  'cache-control',
  'content-disposition',
  'content-language',
  'content-type',
  'etag',
  'last-modified',
  'location',
  'set-cookie',
  'vary',
  // Security headers — forward from upstream
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'x-xss-protection',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
]);

/** Baseline security headers injected if the upstream doesn't send them. */
const DEFAULT_SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function cloneHeaders(headers) {
  const result = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;

    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
      continue;
    }

    result.set(key, String(value));
  }

  return result;
}

http
  .createServer(async (req, res) => {
    try {
      const targetUrl = new URL(req.url || '/', UPSTREAM);
      const headers = cloneHeaders(req.headers);
      headers.set('host', new URL(UPSTREAM).host);
      headers.set('x-forwarded-host', req.headers.host || '');
      headers.set('x-forwarded-proto', 'https');

      const init = {
        method: req.method,
        headers,
        redirect: 'manual',
      };

      if (req.method && !['GET', 'HEAD'].includes(req.method)) {
        init.body = req;
        init.duplex = 'half';
      }

      const upstreamRes = await fetch(targetUrl, init);

      res.statusCode = upstreamRes.status;

      // Node's fetch transparently decompresses gzip/br/deflate bodies, but the
      // response Headers still report the original content-encoding and the
      // (compressed) content-length. Forwarding either to the client makes the
      // browser try to decode plain bytes and abort with
      // ERR_CONTENT_DECODING_FAILED — so when fetch decompressed for us, drop
      // both headers and let Node fall back to chunked transfer encoding.
      const upstreamDecompressed = upstreamRes.headers.has('content-encoding');

      upstreamRes.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower)) return;
        if (!RESPONSE_HEADER_ALLOWLIST.has(lower)) return;
        if (upstreamDecompressed && (lower === 'content-encoding' || lower === 'content-length')) return;

        if (lower === 'location' && value.startsWith(UPSTREAM)) {
          const rewritten = value.replace(UPSTREAM, `https://${req.headers.host}`);
          res.setHeader(key, rewritten);
          return;
        }

        res.setHeader(key, value);
      });

      // Inject baseline security headers if upstream didn't send them
      for (const [header, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
        if (!res.hasHeader(header)) {
          res.setHeader(header, value);
        }
      }

      if (!upstreamRes.body) {
        res.end();
        return;
      }

      // Pipe with backpressure instead of a hand-rolled read/write loop. The
      // previous loop ignored res.write()'s return value and allocated a new
      // Buffer per chunk, which under video load (50–500 MiB streams) created
      // GC pressure and let the socket buffer balloon.
      await pipeline(Readable.fromWeb(upstreamRes.body), res);
    } catch (error) {
      console.error('Proxy request failed', error);
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Bad Gateway');
    }
  })
  .listen(PORT, () => {
    console.log(`Proxy listening on ${PORT}`);
  });
