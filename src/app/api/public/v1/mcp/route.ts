/**
 * Remote MCP endpoint: the same tools as the `@markaestro/mcp` package, served
 * over Streamable HTTP so agents can connect without installing anything.
 *
 *   claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp \
 *     --header "Authorization: Bearer mk_live_..."
 *
 * Stateless by design: every request authenticates the API key, builds a
 * server bound to that key, answers, and discards it. The tools then call the
 * public API on this same host with the caller's key, so scopes, product
 * binding, rate limits, and idempotency are enforced exactly once, by the
 * routes that own them.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { MarkaestroClient } from '@mcp/client';
import { buildServer } from '@mcp/server';

export const runtime = 'nodejs';

const MCP_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

/**
 * The origin the tools call back into. Taken from the request itself rather
 * than configuration, so a preview, a local dev server, and production each
 * call themselves; proxies in front of the app are honoured via the
 * forwarded headers.
 */
function selfOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(/:$/, '');
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

async function handle(req: Request): Promise<Response> {
  try {
    const ctx = await requirePublicApiContext(req, { rateLimit: MCP_RATE_LIMIT });
    // requirePublicApiContext has already validated this header.
    const token = req.headers.get('authorization')!.replace(/^Bearer\s+/i, '');
    const client = new MarkaestroClient({ apiKey: token, baseUrl: selfOrigin(req), maxRetries: 0 });
    const server = buildServer(client, { readOnly: req.headers.get('x-markaestro-read-only') === '1' });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    for (const [name, value] of Object.entries(ctx.rateLimitHeaders)) response.headers.set(name, value);
    return response;
  } catch (error) {
    return publicApiError(error);
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
