import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { encrypt } from '@/lib/crypto';
import { getProviderConfig, getRedirectUri, getClientCredentials } from './config';
import type { OAuthProvider } from '@/lib/schemas';

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
  openId?: string; // TikTok-specific
};

type OAuthState = {
  provider: OAuthProvider;
  workspaceId: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  codeVerifier?: string; // PKCE support (X/Twitter)
  productId?: string; // Per-product social integrations
};

/**
 * Generate an OAuth authorization URL and store state in Firestore.
 */
export async function generateAuthUrl(
  provider: OAuthProvider,
  workspaceId: string,
  userId: string,
  productId?: string,
): Promise<string> {
  const config = getProviderConfig(provider);
  const { clientId } = getClientCredentials(provider);
  const redirectUri = getRedirectUri(provider);

  const stateId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

  const stateDoc: OAuthState = {
    provider,
    workspaceId,
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(productId ? { productId } : {}),
  };

  const clientIdParam = config.clientIdParam || 'client_id';
  const authParams: Record<string, string> = {
    [clientIdParam]: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes.join(provider === 'tiktok' ? ',' : ' '),
    state: stateId,
    ...config.extraAuthParams,
  };

  // PKCE support (required by X/Twitter OAuth 2.0)
  if (config.usePKCE) {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    stateDoc.codeVerifier = codeVerifier;
    authParams.code_challenge = codeChallenge;
    authParams.code_challenge_method = 'S256';
  }

  await adminDb.doc(`oauth_states/${stateId}`).set(stateDoc);

  const params = new URLSearchParams(authParams);

  return `${config.authUrl}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens, verifying state from Firestore.
 */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  stateId: string,
): Promise<{ tokens: OAuthTokens; workspaceId: string; userId: string; productId?: string }> {
  // Verify state
  const stateRef = adminDb.doc(`oauth_states/${stateId}`);
  const stateSnap = await stateRef.get();

  if (!stateSnap.exists) {
    throw new Error('INVALID_STATE');
  }

  const state = stateSnap.data() as OAuthState;

  if (new Date(state.expiresAt) < new Date()) {
    await stateRef.delete();
    throw new Error('STATE_EXPIRED');
  }

  if (state.provider !== provider) {
    await stateRef.delete();
    throw new Error('STATE_MISMATCH');
  }

  // Capture PKCE code_verifier before deleting state
  const codeVerifier = state.codeVerifier;

  // Delete used state
  await stateRef.delete();

  // Exchange code for tokens
  const config = getProviderConfig(provider);
  const { clientId, clientSecret } = getClientCredentials(provider);
  const redirectUri = getRedirectUri(provider);

  const body: Record<string, string> = {
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  };

  // PKCE: include code_verifier
  if (codeVerifier) {
    body.code_verifier = codeVerifier;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // X/Twitter uses Basic Auth for client credentials
  if (config.useBasicAuth) {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    const clientIdParam = config.clientIdParam || 'client_id';
    body[clientIdParam] = clientId;
    body.client_secret = clientSecret;
  }

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body).toString(),
  });

  const data = await res.json();

  if (!res.ok && !data.access_token) {
    throw new Error(`OAuth token exchange failed: ${data.error_description || data.error || data.message || 'Unknown error'}`);
  }

  // Normalize token response (different providers use different field names)
  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
    tokenType: data.token_type,
    scope: data.scope,
    openId: data.open_id, // TikTok-specific
  };

  return { tokens, workspaceId: state.workspaceId, userId: state.userId, productId: state.productId };
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<OAuthTokens> {
  const config = getProviderConfig(provider);
  const { clientId, clientSecret } = getClientCredentials(provider);

  const body: Record<string, string> = {};

  if (provider === 'meta') {
    // Meta uses fb_exchange_token to extend user tokens
    body.grant_type = 'fb_exchange_token';
    body.fb_exchange_token = refreshToken;
  } else {
    body.grant_type = 'refresh_token';
    body.refresh_token = refreshToken;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // X/Twitter uses Basic Auth for client credentials
  if (config.useBasicAuth) {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    const clientIdParam = config.clientIdParam || 'client_id';
    body[clientIdParam] = clientId;
    body.client_secret = clientSecret;
  }

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body).toString(),
  });

  const data = await res.json();

  if (!res.ok && !data.access_token) {
    throw new Error(`Token refresh failed for ${provider}: ${data.error_description || data.error || data.message || 'Unknown error'}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken, // TikTok rotates, others keep same
    expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

/**
 * Revoke an access token with the provider.
 * Best-effort — failures are logged but don't block disconnect.
 */
export async function revokeAccessToken(
  provider: OAuthProvider,
  accessToken: string,
): Promise<void> {
  const config = getProviderConfig(provider);
  if (!config.revokeUrl) return;

  try {
    if (provider === 'meta') {
      // Meta: DELETE /{user-id}/permissions
      await fetch(`${config.revokeUrl}?access_token=${accessToken}`, {
        method: 'DELETE',
      });
    } else if (provider === 'google') {
      // Google: POST with token param
      await fetch(`${config.revokeUrl}?token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } else if (provider === 'x') {
      // X: POST with Basic Auth + token in body
      const { clientId, clientSecret } = getClientCredentials(provider);
      await fetch(config.revokeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: accessToken,
          token_type_hint: 'access_token',
        }).toString(),
      });
    } else if (provider === 'tiktok') {
      // TikTok: POST with client_key + token
      const { clientId, clientSecret } = getClientCredentials(provider);
      await fetch(config.revokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: clientId,
          client_secret: clientSecret,
          token: accessToken,
        }).toString(),
      });
    }
  } catch {
    // Revocation is best-effort — don't block the disconnect flow
  }
}

/**
 * Encrypt and store OAuth tokens in Firestore.
 */
export async function storeTokens(
  workspaceId: string,
  provider: OAuthProvider,
  tokens: OAuthTokens,
  userId: string,
  extraData?: Record<string, unknown>,
  productId?: string,
): Promise<void> {
  const now = new Date();
  const tokenExpiresAt = tokens.expiresIn
    ? new Date(now.getTime() + tokens.expiresIn * 1000).toISOString()
    : null;

  const payload: Record<string, unknown> = {
    provider,
    accessTokenEncrypted: encrypt(tokens.accessToken),
    enabled: true,
    oauthConnected: true,
    status: 'connected',
    tokenExpiresAt,
    updatedAt: now.toISOString(),
    updatedBy: userId,
    ...extraData,
  };

  if (tokens.refreshToken) {
    payload.refreshTokenEncrypted = encrypt(tokens.refreshToken);
  }

  const docPath = productId
    ? `workspaces/${workspaceId}/products/${productId}/integrations/${provider}`
    : `workspaces/${workspaceId}/integrations/${provider}`;

  await adminDb.doc(docPath).set(payload, { merge: true });
}
