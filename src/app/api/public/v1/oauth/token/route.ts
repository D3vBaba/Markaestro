/**
 * OAuth 2.1 token endpoint for connected agents.
 *
 *   grant_type=authorization_code  code + PKCE verifier -> API key + refresh token
 *   grant_type=refresh_token       rotates the key secret and the refresh token
 *
 * Unauthenticated in the session sense: the credential IS the code or the
 * refresh token, both single-use and hashed at rest. Public (PKCE) clients
 * present only their client_id; confidential ones must also present their
 * secret. IP rate limited.
 */
import { NextResponse } from 'next/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { publicApiError } from '@/lib/public-api/response';
import { OAuthError, oauthErrorResponse } from '@/lib/agent-oauth/errors';
import { exchangeAuthorizationCode, readTokenRequest, refreshAccessToken } from '@/lib/agent-oauth/grants';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    await applyRateLimit(req, RATE_LIMITS.api);
    const body = await readTokenRequest(req);

    let tokens;
    switch (body.grant_type) {
      case 'authorization_code':
        tokens = await exchangeAuthorizationCode(req, body);
        break;
      case 'refresh_token':
        tokens = await refreshAccessToken(req, body);
        break;
      case undefined:
      case '':
        throw new OAuthError('invalid_request', 'grant_type is required.');
      default:
        throw new OAuthError('unsupported_grant_type', `Unsupported grant_type: ${body.grant_type}.`);
    }

    const res = NextResponse.json(tokens);
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('Pragma', 'no-cache');
    return res;
  } catch (error) {
    return oauthErrorResponse(error, publicApiError);
  }
}
