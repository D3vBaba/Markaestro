import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { encrypt } from '@/lib/crypto';
import { getProviderConfig, getRedirectUri, getClientCredentials } from './config';
import type { OAuthProvider, SocialChannel } from '@/lib/schemas';
import { PlatformCapability, ConnectionStatus } from '@/lib/platform/types';
import type { PlatformConnection } from '@/lib/platform/types';

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
  codeVerifier?: string;
  productId?: string;
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
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  const stateDoc: OAuthState = {
    provider,
    workspaceId,
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(productId ? { productId } : {}),
  };

  // TikTok Marketing API uses a different auth format
  if (provider === 'tiktok_ads') {
    await adminDb.doc(`oauth_states/${stateId}`).set(stateDoc);
    const params = new URLSearchParams({
      app_id: clientId,
      redirect_uri: redirectUri,
      state: stateId,
    });
    return `${config.authUrl}?${params.toString()}`;
  }

  const clientIdParam = config.clientIdParam || 'client_id';
  const authParams: Record<string, string> = {
    [clientIdParam]: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes.join(provider === 'tiktok' ? ',' : ' '),
    state: stateId,
    ...config.extraAuthParams,
  };

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
): Promise<{ tokens: OAuthTokens; workspaceId: string; userId: string; productId?: string; extraData?: Record<string, unknown> }> {
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

  const codeVerifier = state.codeVerifier;
  await stateRef.delete();

  const config = getProviderConfig(provider);
  const { clientId, clientSecret } = getClientCredentials(provider);
  const redirectUri = getRedirectUri(provider);

  // TikTok Marketing API uses a JSON body with different field names
  if (provider === 'tiktok_ads') {
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: clientId,
        secret: clientSecret,
        auth_code: code,
      }),
    });
    const data = await res.json();

    if (data.code !== 0 || !data.data?.access_token) {
      throw new Error(`TikTok Ads token exchange failed: ${data.message || 'Unknown error'}`);
    }

    const tokens: OAuthTokens = {
      accessToken: data.data.access_token,
      expiresIn: data.data.expires_in ? Number(data.data.expires_in) : undefined,
    };

    return {
      tokens,
      workspaceId: state.workspaceId,
      userId: state.userId,
      productId: state.productId,
      extraData: {
        advertiserId: data.data.advertiser_ids?.[0] || '',
        advertiserIds: data.data.advertiser_ids || [],
      },
    };
  }

  const body: Record<string, string> = {
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  };

  if (codeVerifier) {
    body.code_verifier = codeVerifier;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

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

  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
    tokenType: data.token_type,
    scope: data.scope,
    openId: data.open_id,
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
    body.grant_type = 'fb_exchange_token';
    body.fb_exchange_token = refreshToken;
  } else {
    body.grant_type = 'refresh_token';
    body.refresh_token = refreshToken;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

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
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

/**
 * Revoke an access token with the provider.
 */
export async function revokeAccessToken(
  provider: OAuthProvider,
  accessToken: string,
): Promise<void> {
  const config = getProviderConfig(provider);
  if (!config.revokeUrl) return;

  try {
    if (provider === 'meta') {
      await fetch(`${config.revokeUrl}?access_token=${accessToken}`, { method: 'DELETE' });
    } else if (provider === 'google') {
      await fetch(`${config.revokeUrl}?token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } else if (provider === 'tiktok' || provider === 'tiktok_ads') {
      const { clientId, clientSecret } = getClientCredentials(provider);
      await fetch(config.revokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: clientId, client_secret: clientSecret, token: accessToken }).toString(),
      });
    }
  } catch {
    // Revocation is best-effort
  }
}

/**
 * Store OAuth tokens as a PlatformConnection in Firestore.
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
    : undefined;

  const { channels, capabilities } = providerChannelsAndCapabilities(provider);

  const connection: PlatformConnection = {
    provider,
    channels,
    capabilities,
    status: ConnectionStatus.CONNECTED,
    accessTokenEncrypted: encrypt(tokens.accessToken),
    metadata: extraData || {},
    workspaceId,
    updatedBy: userId,
    updatedAt: now.toISOString(),
    createdAt: now.toISOString(),
  };

  if (tokens.refreshToken) {
    connection.refreshTokenEncrypted = encrypt(tokens.refreshToken);
  }
  if (tokenExpiresAt) {
    connection.tokenExpiresAt = tokenExpiresAt;
  }
  if (productId) {
    connection.productId = productId;
  }

  const connPath = productId
    ? `workspaces/${workspaceId}/products/${productId}/platformConnections/${provider}`
    : `workspaces/${workspaceId}/platformConnections/${provider}`;

  await adminDb.doc(connPath).set(connection, { merge: true });
}

function providerChannelsAndCapabilities(provider: OAuthProvider): {
  channels: SocialChannel[];
  capabilities: PlatformCapability[];
} {
  switch (provider) {
    case 'meta':
      return {
        channels: ['facebook', 'instagram'],
        capabilities: [PlatformCapability.PUBLISH_TEXT, PlatformCapability.PUBLISH_IMAGE, PlatformCapability.PUBLISH_CAROUSEL],
      };
    case 'tiktok':
      return {
        channels: ['tiktok'],
        capabilities: [PlatformCapability.PUBLISH_IMAGE, PlatformCapability.PUBLISH_VIDEO],
      };
    case 'tiktok_ads':
      return {
        channels: [],
        capabilities: [PlatformCapability.ADS],
      };
    case 'google':
      return {
        channels: [],
        capabilities: [PlatformCapability.ADS],
      };
  }
}
