const http = require('http');

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
  'content-length',
]);
const RESPONSE_HEADER_ALLOWLIST = new Set([
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-language',
  'content-type',
  'etag',
  'last-modified',
  'location',
  'set-cookie',
  'vary',
]);

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

      upstreamRes.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower)) return;
        if (!RESPONSE_HEADER_ALLOWLIST.has(lower)) return;

        if (lower === 'location' && value.startsWith(UPSTREAM)) {
          const rewritten = value.replace(UPSTREAM, `https://${req.headers.host}`);
          res.setHeader(key, rewritten);
          return;
        }

        res.setHeader(key, value);
      });

      if (!upstreamRes.body) {
        res.end();
        return;
      }

      const reader = upstreamRes.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }

      res.end();
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
