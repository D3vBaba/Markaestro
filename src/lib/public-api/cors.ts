/**
 * CORS support for /api/public/v1/*.
 *
 * Origin allowlist is controlled by the PUBLIC_API_CORS_ORIGINS env var
 * (comma-separated). `*` is explicitly disallowed to avoid
 * credential-bearing cross-origin reads; callers must either list
 * specific origins or omit the header entirely and use server-to-server
 * requests.
 *
 * If no allowlist is configured, CORS headers are omitted — safe default
 * because server-to-server traffic is unaffected.
 */

const DEFAULT_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const DEFAULT_HEADERS = 'Authorization,Content-Type,Idempotency-Key';

function getAllowedOrigins(): string[] {
  return (process.env.PUBLIC_API_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return {};
  const allowed = getAllowedOrigins();
  if (!allowed.length) return {};
  if (!allowed.includes(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'false',
    'Access-Control-Allow-Methods': DEFAULT_METHODS,
    'Access-Control-Allow-Headers': DEFAULT_HEADERS,
    'Access-Control-Max-Age': '86400',
  };
}

/** Return an appropriate 204 response for an OPTIONS preflight. */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  const headers = resolveCorsHeaders(req);
  return new Response(null, { status: 204, headers });
}

/** Merge CORS headers onto an existing Response. */
export function withCors(req: Request, response: Response): Response {
  const cors = resolveCorsHeaders(req);
  if (!Object.keys(cors).length) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
