import type { OAuthProvider } from '@/lib/schemas';

export type OAuthProviderConfig = {
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Override the `client_id` param name (e.g. TikTok uses `client_key`). */
  clientIdParam?: string;
  extraAuthParams?: Record<string, string>;
  usePKCE?: boolean;
  useBasicAuth?: boolean;
};

const providerConfigs: Record<OAuthProvider, OAuthProviderConfig> = {
  meta: {
    authUrl: 'https://www.facebook.com/v22.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v22.0/oauth/access_token',
    revokeUrl: 'https://graph.facebook.com/v22.0/me/permissions',
    scopes: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'business_management',
      'instagram_basic',
      'instagram_content_publish',
      'instagram_manage_insights',
    ],
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    extraAuthParams: {},
  },
  instagram: {
    authUrl: 'https://www.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    scopes: [
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_insights',
    ],
    clientIdEnv: 'INSTAGRAM_APP_ID',
    clientSecretEnv: 'INSTAGRAM_APP_SECRET',
    extraAuthParams: {},
  },
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    revokeUrl: 'https://open.tiktokapis.com/v2/oauth/revoke/',
    scopes: [
      'user.info.basic',
      'user.info.profile',
      'user.info.stats',
      'video.publish',
      'video.upload',
    ],
    clientIdEnv: 'TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
    clientIdParam: 'client_key',
    extraAuthParams: {},
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    // openid/profile/email come from the Sign In with LinkedIn using OpenID Connect product,
    // and are used here solely to obtain the member's Person URN via /v2/userinfo.
    // w_member_social comes from the Share on LinkedIn product and authorizes posting.
    // Organization posting (w_organization_social, r_organization_social) requires the
    // Community Management API product, which is review-gated — add those scopes here
    // once the app is approved.
    scopes: [
      'openid',
      'profile',
      'email',
      'w_member_social',
    ],
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    extraAuthParams: {},
  },
  threads: {
    authUrl: 'https://threads.net/oauth/authorize',
    tokenUrl: 'https://graph.threads.net/oauth/access_token',
    scopes: [
      'threads_basic',
      'threads_content_publish',
      'threads_manage_insights',
    ],
    clientIdEnv: 'THREADS_APP_ID',
    clientSecretEnv: 'THREADS_APP_SECRET',
    extraAuthParams: {},
  },
  pinterest: {
    authUrl: 'https://www.pinterest.com/oauth/',
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    scopes: [
      'boards:read',
      'boards:write',
      'pins:read',
      'pins:write',
      'user_accounts:read',
    ],
    clientIdEnv: 'PINTEREST_CLIENT_ID',
    clientSecretEnv: 'PINTEREST_CLIENT_SECRET',
    useBasicAuth: true,
    extraAuthParams: {},
  },
  youtube: {
    // YouTube Data API v3 uses Google OAuth. Scope youtube.upload lets us upload videos;
    // youtube.readonly lets us list the user's channels for the post-auth channel picker.
    // access_type=offline + prompt=consent ensures we receive a refresh token on every
    // authorization (Google only issues one when prompt=consent).
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
    clientIdEnv: 'YOUTUBE_CLIENT_ID',
    clientSecretEnv: 'YOUTUBE_CLIENT_SECRET',
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
  },
  x: {
    // X (Twitter) API v2 — OAuth 2.0 with PKCE. tweet.write requires the Pay Per Use
    // metered plan (or Basic tier). offline.access issues a refresh_token, which we
    // rotate on every refresh (X refresh tokens are single-use).
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    revokeUrl: 'https://api.twitter.com/2/oauth2/revoke',
    scopes: [
      'tweet.read',
      'tweet.write',
      'users.read',
      'offline.access',
      'media.write',
    ],
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
    usePKCE: true,
    useBasicAuth: true,
    extraAuthParams: {},
  },
};

export function getProviderConfig(provider: OAuthProvider): OAuthProviderConfig {
  return providerConfigs[provider];
}

const redirectUriEnvByProvider: Record<OAuthProvider, string> = {
  meta: 'META_OAUTH_REDIRECT_URI',
  instagram: 'INSTAGRAM_OAUTH_REDIRECT_URI',
  tiktok: 'TIKTOK_OAUTH_REDIRECT_URI',
  linkedin: 'LINKEDIN_OAUTH_REDIRECT_URI',
  threads: 'THREADS_OAUTH_REDIRECT_URI',
  pinterest: 'PINTEREST_OAUTH_REDIRECT_URI',
  youtube: 'YOUTUBE_OAUTH_REDIRECT_URI',
  x: 'X_OAUTH_REDIRECT_URI',
};

export function getAppUrl(): string {
  const base =
    process.env.OAUTH_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

export function getRedirectUri(provider: OAuthProvider): string {
  const exactRedirectUri = process.env[redirectUriEnvByProvider[provider]]?.trim();
  if (exactRedirectUri) {
    return exactRedirectUri;
  }
  return `${getAppUrl()}/api/oauth/callback/${provider}`;
}

export function getClientCredentials(provider: OAuthProvider): { clientId: string; clientSecret: string } {
  const config = getProviderConfig(provider);
  const clientId = process.env[config.clientIdEnv] || '';
  const clientSecret = process.env[config.clientSecretEnv] || '';
  if (!clientId || !clientSecret) {
    throw new Error(`Missing OAuth credentials for ${provider}: ${config.clientIdEnv} and/or ${config.clientSecretEnv}`);
  }
  return { clientId, clientSecret };
}
