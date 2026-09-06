/**
 * Remote MCP endpoint: the same tools as the `@markaestro/mcp` package, served
 * over Streamable HTTP so agents can connect without installing anything.
 *
 *   claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp
 *
 * With no Authorization header the endpoint answers 401 with a
 * WWW-Authenticate challenge, and the client signs the user in through the
 * browser (src/lib/agent-oauth). A static key still works:
 *
 *   claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp \
 *     --header "Authorization: Bearer mk_live_..."
 *
 * or, for connector dialogs that only offer an API-key field, as `x-api-key`.
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
import { bearerChallenge } from '@/lib/agent-oauth/metadata';
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

/**
 * Some connector dialogs (Grok Bot's beta among them) offer a single
 * "API key" field that is sent as `x-api-key` rather than letting the user
 * name the header. Accept the workspace key there too, by rewriting it into
 * the bearer header the rest of the API understands. An explicit
 * Authorization header always wins; the alias is never consulted alongside
 * one, so it cannot be used to smuggle a second credential.
 */
async function withBearerAlias(req: Request): Promise<Request> {
  if (req.headers.has('authorization')) return req;
  const apiKey = req.headers.get('x-api-key')?.trim();
  if (!apiKey) return req;
  const headers = new Headers(req.headers);
  headers.delete('x-api-key');
  headers.set('authorization', `Bearer ${apiKey}`);
  // Buffer the body rather than re-wrapping the framework's request: the
  // runtime's Request cannot be cloned with a new header set once its body
  // stream is attached. MCP requests are small JSON-RPC envelopes, and the
  // endpoint is stateless, so the copy costs nothing that matters.
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  return new Request(req.url, { method: req.method, headers, body });
}

async function handle(incoming: Request): Promise<Response> {
  const req = await withBearerAlias(incoming);
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
    const response = publicApiError(error);
    // A 401 carries the RFC 9728 challenge that points an MCP client at the
    // OAuth discovery documents, which is how "sign in with your browser"
    // starts. Clients holding a static key never see it.
    if (response.status === 401) {
      response.headers.set('WWW-Authenticate', bearerChallenge(selfOrigin(req)));
    }
    return response;
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
