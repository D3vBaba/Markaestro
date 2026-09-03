/**
 * Consent page support: resolve the client named in an authorization
 * request so the page can show who is asking, and confirm the redirect URI
 * is one that client registered. Read-only; any signed-in user may ask,
 * because the page has to explain the request before it can tell them they
 * need an admin.
 */
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getOAuthClient } from '@/lib/agent-oauth/store';
import { redirectUriMatches } from '@/lib/agent-oauth/redirect-uri';
import { parseScopeParam } from '@/lib/agent-oauth/metadata';

export const runtime = 'nodejs';

const querySchema = z.object({
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().min(1).max(2048),
  scope: z.string().max(500).optional(),
});

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: ctx.uid });
    const url = new URL(req.url);
    const query = querySchema.parse({
      client_id: url.searchParams.get('client_id') ?? '',
      redirect_uri: url.searchParams.get('redirect_uri') ?? '',
      scope: url.searchParams.get('scope') ?? undefined,
    });

    const client = await getOAuthClient(query.client_id);
    if (!client) {
      return apiOk({ error: 'OAUTH_CLIENT_NOT_FOUND', message: 'Unknown client. Ask the agent to reconnect.' }, 404);
    }
    if (!client.redirectUris.some((registered) => redirectUriMatches(registered, query.redirect_uri))) {
      return apiOk({ error: 'OAUTH_REDIRECT_URI_MISMATCH', message: 'The redirect address is not registered for this client.' }, 400);
    }
    const { scopes, unknown } = parseScopeParam(query.scope);
    if (unknown.length > 0 || scopes.length === 0) {
      return apiOk({ error: 'OAUTH_INVALID_SCOPE', message: 'The agent asked for a scope this server does not offer.', unknown }, 400);
    }

    return apiOk({
      client: {
        id: query.client_id,
        name: client.clientName,
        uri: client.clientUri,
      },
      scopes,
    });
  } catch (error) {
    return apiError(error);
  }
}
