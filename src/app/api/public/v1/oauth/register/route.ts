/**
 * Dynamic client registration (RFC 7591) for MCP clients.
 *
 * An MCP client that finds this server through discovery registers itself
 * here before opening the consent page. Registration is anonymous by
 * design: the client has no credential yet. It is bounded by an IP rate
 * limit, by strict redirect-URI rules, and by a TTL on idle clients.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { publicApiError } from '@/lib/public-api/response';
import { OAuthError, oauthErrorResponse } from '@/lib/agent-oauth/errors';
import { isAllowedRedirectUri } from '@/lib/agent-oauth/redirect-uri';
import { createOAuthClient, type TokenEndpointAuthMethod } from '@/lib/agent-oauth/store';

export const runtime = 'nodejs';

const registrationSchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(10),
  client_name: z.string().trim().max(200).optional(),
  client_uri: z.string().url().max(2048).optional(),
  grant_types: z.array(z.string()).max(5).optional(),
  response_types: z.array(z.string()).max(5).optional(),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).optional(),
  scope: z.string().max(500).optional(),
}).passthrough();

const SUPPORTED_GRANTS = new Set(['authorization_code', 'refresh_token']);

export async function POST(req: Request) {
  try {
    await applyRateLimit(req, RATE_LIMITS.auth);
    const raw = await req.json().catch(() => null);
    const parsed = registrationSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OAuthError('invalid_client_metadata', 'redirect_uris (array of absolute URLs) is required.');
    }
    const data = parsed.data;

    const bad = data.redirect_uris.find((uri) => !isAllowedRedirectUri(uri));
    if (bad) {
      throw new OAuthError(
        'invalid_redirect_uri',
        'Redirect URIs must be https, an http loopback address, or a custom app scheme.',
      );
    }

    const grantTypes = data.grant_types?.length ? data.grant_types : ['authorization_code', 'refresh_token'];
    const unsupported = grantTypes.find((g) => !SUPPORTED_GRANTS.has(g));
    if (unsupported) {
      throw new OAuthError('invalid_client_metadata', `Unsupported grant_type: ${unsupported}.`);
    }
    const responseTypes = data.response_types?.length ? data.response_types : ['code'];
    if (responseTypes.some((r) => r !== 'code')) {
      throw new OAuthError('invalid_client_metadata', 'Only the code response type is supported.');
    }
    const authMethod: TokenEndpointAuthMethod = data.token_endpoint_auth_method ?? 'none';

    const created = await createOAuthClient({
      clientName: data.client_name?.trim() || 'MCP client',
      redirectUris: data.redirect_uris,
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod: authMethod,
      clientUri: data.client_uri ?? null,
    });

    const res = NextResponse.json(
      {
        client_id: created.clientId,
        client_id_issued_at: Math.floor(new Date(created.createdAt).getTime() / 1000),
        ...(created.clientSecret ? { client_secret: created.clientSecret, client_secret_expires_at: 0 } : {}),
        client_name: data.client_name?.trim() || 'MCP client',
        ...(data.client_uri ? { client_uri: data.client_uri } : {}),
        redirect_uris: data.redirect_uris,
        grant_types: grantTypes,
        response_types: responseTypes,
        token_endpoint_auth_method: authMethod,
        ...(data.scope ? { scope: data.scope } : {}),
      },
      { status: 201 },
    );
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (error) {
    return oauthErrorResponse(error, publicApiError);
  }
}
