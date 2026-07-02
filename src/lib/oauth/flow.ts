import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { encrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { getProviderConfig, getRedirectUri, getClientCredentials } from './config';
import type { OAuthProvider, SocialChannel } from '@/lib/schemas';
import { PlatformCapability, ConnectionStatus } from '@/lib/platform/types';
import type { PlatformConnection } from '@/lib/platform/types';
import { IG_LOGIN_UNSUPPORTED_MESSAGE, isInstagramGraphRefusal, isInstagramMethodTypeUnsupported } from '@/lib/oauth/instagram-errors';

/**
 * Flatten a provider token-endpoint error payload into a readable message.
 * Graph-style errors nest an object under `error` — stringifying that
 * directly produced "[object Object]" in stored lastRefreshError values.
 */
function describeTokenError(data: Record<string, unknown>): string {
  const error = data?.error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
    return JSON.stringify(error).slice(0, 300);
  }
  return String(data?.error_description || data?.error_message || error || data?.message || 'Unknown error');
}
import {
  linkedinStorageProviderForKind,
  type LinkedInCredentialKind,
} from '@/lib/platform/linkedin-providers';

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshTokenExpiresIn?: number;
  tokenType?: string;
  scope?: string;
  openId?: string; // TikTok-specific
  idToken?: string;
};

type OAuthState = {
  provider: OAuthProvider;
  workspaceId: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  codeVerifier?: string;
  productId?: string;
  returnTo?: string;
  linkedinCredentialKind?: LinkedInCredentialKind;
};

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * Generate an OAuth authorization URL and store state in Firestore.
 */
export async function generateAuthUrl(
  provider: OAuthProvider,
  workspaceId: string,
  userId: string,
  productId?: string,
  returnTo?: string,
  options: { linkedinCredentialKind?: LinkedInCredentialKind } = {},
): Promise<string> {
  const linkedinCredentialKind = provider === 'linkedin'
    ? options.linkedinCredentialKind || 'profile'
    : undefined;
  const config = getProviderConfig(provider, linkedinCredentialKind);
  const { clientId } = getClientCredentials(provider, linkedinCredentialKind);
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
    ...(returnTo ? { returnTo } : {}),
    ...(linkedinCredentialKind ? { linkedinCredentialKind } : {}),
  };

  const clientIdParam = config.clientIdParam || 'client_id';
  // Scope separator varies by provider: OAuth 2 spec says space, but Instagram
  // Business Login, TikTok, and Meta's Threads dialog use comma-separated scopes.
  const commaSeparated = provider === 'instagram' || provider === 'tiktok' || provider === 'threads';
  const authParams: Record<string, string> = {
    [clientIdParam]: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes.join(commaSeparated ? ',' : ' '),
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
  if (provider === 'linkedin') {
    logger.info('linkedin authorization url created', {
      event: 'oauth.linkedin.authorize.created',
      kind: linkedinCredentialKind,
      clientIdHash: shortHash(clientId),
      stateHash: shortHash(stateId),
      redirectUri,
      scopes: config.scopes.join(' '),
      productId: productId || null,
    });
  }
  return `${config.authUrl}?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeOAuthTokenResponse(
  provider: OAuthProvider,
  data: unknown,
): Record<string, unknown> {
  if (!isRecord(data)) return {};

  if (provider !== 'instagram') {
    return data;
  }

  const nested = data.data;
  if (Array.isArray(nested) && isRecord(nested[0])) {
    return nested[0];
  }

  return data;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalIdString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function instagramExtraDataFromTokenResponse(
  tokenData: Record<string, unknown>,
): Record<string, unknown> {
  const extraData: Record<string, unknown> = {};

  const instagramUserId = optionalIdString(tokenData.user_id);
  if (instagramUserId) extraData.igAccountId = instagramUserId;

  const permissions = optionalString(tokenData.permissions);
  if (permissions) extraData.instagramPermissions = permissions;

  return extraData;
}

/**
 * Exchange an authorization code for tokens, verifying state from Firestore.
 */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  stateId: string,
): Promise<{
  tokens: OAuthTokens;
  workspaceId: string;
  userId: string;
  productId?: string;
  returnTo?: string;
  extraData?: Record<string, unknown>;
  linkedinCredentialKind?: LinkedInCredentialKind;
  storageProvider?: string;
}> {
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

  let linkedinCredentialKind = provider === 'linkedin'
    ? state.linkedinCredentialKind || 'profile'
    : undefined;
  const redirectUri = getRedirectUri(provider);

  async function requestToken(kind?: LinkedInCredentialKind) {
    const config = getProviderConfig(provider, kind);
    const { clientId, clientSecret } = getClientCredentials(provider, kind);
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
      Accept: 'application/json',
    };

    if (config.useBasicAuth) {
      // RFC 6749 §2.3.1: client_id and client_secret in Basic Auth must be
      // percent-encoded before base64. Pinterest enforces this strictly — raw
      // creds with special characters return "Authentication failed".
      const encoded = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
      headers.Authorization = `Basic ${Buffer.from(encoded).toString('base64')}`;
      // X confidential clients require client_id in the body *in addition* to
      // the Basic Auth header. Sending it everywhere is safe — other providers
      // ignore it when the header auth is valid.
      const clientIdParam = config.clientIdParam || 'client_id';
      body[clientIdParam] = clientId;
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
    const tokenData = normalizeOAuthTokenResponse(provider, data);
    const accessToken = optionalString(tokenData.access_token);
    if (provider === 'linkedin') {
      logger.info('linkedin token exchange response', {
        event: 'oauth.linkedin.token_exchange.response',
        kind,
        clientIdHash: shortHash(clientId),
        httpStatus: res.status,
        hasAccessToken: Boolean(accessToken),
        redirectUri,
        error: res.ok ? null : String(data.error_description || data.error || data.message || 'Unknown error'),
      });
    }
    return { res, data, tokenData, accessToken };
  }

  let tokenResponse = await requestToken(linkedinCredentialKind);
  let { res, data, tokenData, accessToken } = tokenResponse;

  if (
    provider === 'linkedin' &&
    linkedinCredentialKind &&
    (!res.ok || !accessToken) &&
    /client authentication failed/i.test(String(data.error_description || data.error || data.message || ''))
  ) {
    const retryKind: LinkedInCredentialKind = linkedinCredentialKind === 'community' ? 'profile' : 'community';
    logger.warn('linkedin token exchange retrying alternate client', {
      event: 'oauth.linkedin.token_exchange.retry_alternate_client',
      requestedKind: linkedinCredentialKind,
      retryKind,
      httpStatus: res.status,
      error: String(data.error_description || data.error || data.message || 'Unknown error'),
    });
    tokenResponse = await requestToken(retryKind);
    ({ res, data, tokenData, accessToken } = tokenResponse);
    if (res.ok && accessToken) {
      linkedinCredentialKind = retryKind;
    }
  }

  if (provider === 'instagram') {
    // Confirm the short-lived token's response shape (never log the token) so
    // we can tell whether access_token is where exchangeInstagramToken reads it.
    logger.info('instagram short-lived exchange response', {
      event: 'oauth.instagram.short_lived.response',
      httpStatus: res.status,
      keys: Object.keys(data || {}).join(','),
      tokenKeys: Object.keys(tokenData || {}).join(','),
      hasAccessToken: Boolean(accessToken),
      hasTopLevelAccessToken: Boolean(data?.access_token),
      hasNestedAccessToken: Boolean(Array.isArray(data?.data) && data.data.some((item: unknown) => isRecord(item) && Boolean(item.access_token))),
      hasUserId: Boolean(tokenData?.user_id),
    });
  }

  if (!res.ok || !accessToken) {
    throw new Error(`OAuth token exchange failed: ${data.error_description || data.error || data.message || 'Unknown error'}`);
  }

  const tokens: OAuthTokens = {
    accessToken,
    refreshToken: optionalString(tokenData.refresh_token),
    expiresIn: optionalNumber(tokenData.expires_in),
    refreshTokenExpiresIn: optionalNumber(tokenData.refresh_token_expires_in),
    tokenType: optionalString(tokenData.token_type),
    scope: optionalString(tokenData.scope) || optionalString(tokenData.permissions),
    openId: optionalString(tokenData.open_id),
    idToken: optionalString(tokenData.id_token),
  };

  const extraData: Record<string, unknown> = {};
  if (provider === 'instagram') {
    Object.assign(extraData, instagramExtraDataFromTokenResponse(tokenData));
  }

  return {
    tokens,
    workspaceId: state.workspaceId,
    userId: state.userId,
    productId: state.productId,
    returnTo: state.returnTo,
    extraData: Object.keys(extraData).length > 0 ? extraData : undefined,
    ...(linkedinCredentialKind ? {
      linkedinCredentialKind,
      storageProvider: linkedinStorageProviderForKind(linkedinCredentialKind),
    } : {}),
  };
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
  options: { linkedinCredentialKind?: LinkedInCredentialKind } = {},
): Promise<OAuthTokens> {
  if (provider === 'instagram') {
    let res = await fetch(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
        grant_type: 'ig_refresh_token',
        access_token: refreshToken,
      }).toString()}`,
      { method: 'GET' },
    );
    let data = await res.json();

    if (!res.ok && isInstagramMethodTypeUnsupported(data, 'get')) {
      res = await fetch('https://graph.instagram.com/refresh_access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'ig_refresh_token',
          access_token: refreshToken,
        }).toString(),
      });
      data = await res.json();
    }

    if (!res.ok && !data.access_token) {
      // Blanket code-100 refusal: graph.instagram.com does not serve this
      // token at all (account not eligible for the Instagram API) — permanent.
      if (isInstagramGraphRefusal(data)) {
        throw new Error(IG_LOGIN_UNSUPPORTED_MESSAGE);
      }
      throw new Error(`Token refresh failed for ${provider}: ${describeTokenError(data)}`);
    }

    return {
      accessToken: data.access_token || refreshToken,
      refreshToken: data.access_token || refreshToken,
      expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
      tokenType: data.token_type,
      scope: data.scope,
    };
  }

  if (provider === 'threads') {
    // Threads long-lived tokens refresh in place (th_refresh_token), same
    // model as Instagram Login — there is no separate refresh token.
    const res = await fetch(
      `https://graph.threads.net/refresh_access_token?${new URLSearchParams({
        grant_type: 'th_refresh_token',
        access_token: refreshToken,
      }).toString()}`,
      { method: 'GET' },
    );
    const data = await res.json();

    if (!res.ok && !data.access_token) {
      throw new Error(`Token refresh failed for ${provider}: ${describeTokenError(data)}`);
    }

    return {
      accessToken: data.access_token || refreshToken,
      refreshToken: data.access_token || refreshToken,
      expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
      tokenType: data.token_type,
      scope: data.scope,
    };
  }

  const config = getProviderConfig(provider, options.linkedinCredentialKind);
  const { clientId, clientSecret } = getClientCredentials(provider, options.linkedinCredentialKind);

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
    Accept: 'application/json',
  };

  if (config.useBasicAuth) {
    const encoded = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
    headers['Authorization'] = `Basic ${Buffer.from(encoded).toString('base64')}`;
    const clientIdParam = config.clientIdParam || 'client_id';
    body[clientIdParam] = clientId;
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
    throw new Error(`Token refresh failed for ${provider}: ${describeTokenError(data)}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
    refreshTokenExpiresIn: data.refresh_token_expires_in ? Number(data.refresh_token_expires_in) : undefined,
    tokenType: data.token_type,
    scope: data.scope,
    idToken: data.id_token,
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
    } else if (provider === 'tiktok') {
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
  storageProvider?: string,
): Promise<void> {
  const now = new Date();
  const tokenExpiresAt = tokens.expiresIn
    ? new Date(now.getTime() + tokens.expiresIn * 1000).toISOString()
    : undefined;
  const refreshTokenExpiresAt = tokens.refreshTokenExpiresIn
    ? new Date(now.getTime() + tokens.refreshTokenExpiresIn * 1000).toISOString()
    : undefined;

  const connectionProvider = storageProvider || provider;
  const { channels, capabilities } = providerChannelsAndCapabilities(connectionProvider);

  const connPath = productId
    ? `workspaces/${workspaceId}/products/${productId}/platformConnections/${connectionProvider}`
    : `workspaces/${workspaceId}/platformConnections/${connectionProvider}`;
  const connRef = adminDb.doc(connPath);
  const existingSnap = await connRef.get();
  const existing = existingSnap.exists ? (existingSnap.data() as Partial<PlatformConnection>) : null;

  const connection: PlatformConnection = {
    provider: connectionProvider,
    channels,
    capabilities,
    status: ConnectionStatus.CONNECTED,
    accessTokenEncrypted: encrypt(tokens.accessToken),
    metadata: {
      lastRefreshError: null,
      refreshFailureCount: 0,
      ...(tokens.scope ? { oauthScopes: tokens.scope } : {}),
      ...(refreshTokenExpiresAt ? { refreshTokenExpiresAt } : {}),
      ...(extraData || {}),
    },
    workspaceId,
    updatedBy: userId,
    updatedAt: now.toISOString(),
    createdAt: existing?.createdAt || now.toISOString(),
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
  await connRef.set(connection);
}

function providerChannelsAndCapabilities(provider: string): {
  channels: SocialChannel[];
  capabilities: PlatformCapability[];
} {
  switch (provider) {
    case 'meta':
      return {
        channels: ['facebook', 'instagram'],
        capabilities: [PlatformCapability.PUBLISH_TEXT, PlatformCapability.PUBLISH_IMAGE, PlatformCapability.PUBLISH_CAROUSEL],
      };
    case 'instagram':
      return {
        channels: ['instagram'],
        capabilities: [PlatformCapability.PUBLISH_IMAGE, PlatformCapability.PUBLISH_VIDEO, PlatformCapability.PUBLISH_CAROUSEL],
      };
    case 'tiktok':
      return {
        channels: ['tiktok'],
        capabilities: [PlatformCapability.PUBLISH_IMAGE, PlatformCapability.PUBLISH_VIDEO],
      };
    case 'threads':
      return {
        channels: ['threads'],
        capabilities: [
          PlatformCapability.PUBLISH_TEXT,
          PlatformCapability.PUBLISH_IMAGE,
          PlatformCapability.PUBLISH_VIDEO,
          PlatformCapability.PUBLISH_CAROUSEL,
        ],
      };
    case 'pinterest':
      return {
        channels: ['pinterest'],
        capabilities: [
          PlatformCapability.PUBLISH_IMAGE,
          PlatformCapability.PUBLISH_VIDEO,
        ],
      };
    case 'linkedin':
    case 'linkedin_profile':
    case 'linkedin_community':
      return {
        channels: ['linkedin'],
        capabilities: [
          PlatformCapability.PUBLISH_TEXT,
          PlatformCapability.PUBLISH_IMAGE,
          PlatformCapability.PUBLISH_VIDEO,
          PlatformCapability.PUBLISH_CAROUSEL,
        ],
      };
    default:
      throw new Error(`Unsupported OAuth provider: ${provider}`);
  }
}
