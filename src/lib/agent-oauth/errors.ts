import { NextResponse } from 'next/server';

/**
 * OAuth 2.1 error codes (RFC 6749 §5.2, RFC 7591 §3.2.2). These are the
 * wire format every MCP client parses, so they are kept verbatim rather than
 * mapped onto the app's own `error` codes.
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'
  | 'access_denied'
  | 'server_error';

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly status: number;

  constructor(code: OAuthErrorCode, description: string, status = 400) {
    super(description);
    this.name = 'OAuthError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Render an OAuth error. Anything that is not an OAuthError (a rate-limit
 * Response thrown by applyRateLimit, an unexpected exception) is passed to
 * `fallback`, which is the app's regular error boundary.
 */
export function oauthErrorResponse(error: unknown, fallback: (error: unknown) => Response): Response {
  if (error instanceof OAuthError) {
    const res = NextResponse.json(
      { error: error.code, error_description: error.message },
      { status: error.status },
    );
    res.headers.set('Cache-Control', 'no-store');
    if (error.code === 'invalid_client') {
      res.headers.set('WWW-Authenticate', 'Basic realm="markaestro"');
    }
    return res;
  }
  return fallback(error);
}
