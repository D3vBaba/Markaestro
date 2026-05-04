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
const REQUEST_HEADER_BLOCKLIST = new Set([
  // The proxy is a transforming intermediary because Node fetch may decode
  // compressed upstream bodies before exposing the stream. Request identity
  // bytes so response metadata still describes the body we pipe downstream.
  'accept-encoding',
]);
const FETCH_DECODED_RESPONSE_HEADERS = new Set([
  'accept-ranges',
  'content-encoding',
  'content-length',
  'content-range',
  'etag',
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
  'content-security-policy-report-only',
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'x-dns-prefetch-control',
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

const HTML_SHELL_CACHE_CONTROL = 'private, no-cache, no-store, max-age=0, must-revalidate';

function cloneRequestHeaders(headers) {
  const result = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (REQUEST_HEADER_BLOCKLIST.has(lower)) continue;

    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
      continue;
    }

    result.set(key, String(value));
  }

  return result;
}

function isHtmlShellResponse(headers) {
  const contentType = headers.get('content-type') || '';
  return contentType.includes('text/html') || contentType.includes('text/x-component');
}

function sanitizeHeaderValue(key, value) {
  if (key.toLowerCase() !== 'content-security-policy-report-only') {
    return value;
  }

  // Browsers ignore upgrade-insecure-requests in Report-Only policies and log
  // a console warning for every page load. Keep the real CSP report policy,
  // but strip the no-op directive while the upstream app rolls forward.
  return value
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive && directive !== 'upgrade-insecure-requests')
    .join('; ');
}

http
  .createServer(async (req, res) => {
    try {
      const targetUrl = new URL(req.url || '/', UPSTREAM);
      const headers = cloneRequestHeaders(req.headers);
      headers.set('host', new URL(UPSTREAM).host);
      headers.set('accept-encoding', 'identity');
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
      // response Headers still report the original encoded representation. We
      // request identity bytes above; this fallback keeps the proxy safe if an
      // upstream ignores that request.
      const upstreamDecompressed = upstreamRes.headers.has('content-encoding');
      const htmlShellResponse = isHtmlShellResponse(upstreamRes.headers);

      upstreamRes.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower)) return;
        if (!RESPONSE_HEADER_ALLOWLIST.has(lower)) return;
        if (upstreamDecompressed && FETCH_DECODED_RESPONSE_HEADERS.has(lower)) return;

        if (lower === 'location' && value.startsWith(UPSTREAM)) {
          const rewritten = value.replace(UPSTREAM, `https://${req.headers.host}`);
          res.setHeader(key, rewritten);
          return;
        }

        if (htmlShellResponse && lower === 'cache-control') return;

        res.setHeader(key, sanitizeHeaderValue(key, value));
      });

      if (htmlShellResponse) {
        res.setHeader('cache-control', HTML_SHELL_CACHE_CONTROL);
        res.setHeader('pragma', 'no-cache');
        res.setHeader('expires', '0');
      }

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
