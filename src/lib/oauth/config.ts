import type { OAuthProvider } from '@/lib/schemas';
import type { LinkedInCredentialKind } from '@/lib/platform/linkedin-providers';

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

const linkedinProfileConfig: OAuthProviderConfig = {
  authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
  tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
  scopes: [
    'openid',
    'profile',
    'w_member_social',
  ],
  clientIdEnv: 'LINKEDIN_PROFILE_CLIENT_ID',
  clientSecretEnv: 'LINKEDIN_PROFILE_CLIENT_SECRET',
  extraAuthParams: {},
};

const linkedinCommunityConfig: OAuthProviderConfig = {
  authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
  tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
  scopes: [
    'r_basicprofile',
    'w_organization_social',
    'r_organization_social',
    // The approved developer configuration exposes rw_organization_admin,
    // not r_organization_admin. We request it only to discover administrable
    // Pages via read-only Organization ACL/lookup endpoints.
    'rw_organization_admin',
  ],
  clientIdEnv: 'LINKEDIN_COMMUNITY_CLIENT_ID',
  clientSecretEnv: 'LINKEDIN_COMMUNITY_CLIENT_SECRET',
  extraAuthParams: {},
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
    ],
    clientIdEnv: 'INSTAGRAM_APP_ID',
    clientSecretEnv: 'INSTAGRAM_APP_SECRET',
    // enable_fb_login MUST stay 'false': with 'true', the Instagram dialog
    // offers Facebook SSO, which on mobile hands off to the native Facebook/
    // Instagram app (the app opens and the connect never completes in-browser).
    // 'false' keeps a pure in-browser Instagram web login so users can connect
    // from the mobile browser.
    extraAuthParams: {
      enable_fb_login: 'false',
    },
  },
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    revokeUrl: 'https://open.tiktokapis.com/v2/oauth/revoke/',
    scopes: [
      'user.info.basic',
      'user.info.profile',
      'video.publish',
      'video.upload',
    ],
    clientIdEnv: 'TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
    clientIdParam: 'client_key',
    extraAuthParams: {},
  },
  threads: {
    authUrl: 'https://threads.net/oauth/authorize',
    tokenUrl: 'https://graph.threads.net/oauth/access_token',
    scopes: [
      'threads_basic',
      'threads_content_publish',
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
  linkedin: {
    ...linkedinProfileConfig,
  },
};

export function getProviderConfig(
  provider: OAuthProvider,
  linkedinCredentialKind?: LinkedInCredentialKind,
): OAuthProviderConfig {
  if (provider === 'linkedin') {
    return linkedinCredentialKind === 'community'
      ? linkedinCommunityConfig
      : linkedinProfileConfig;
  }
  return providerConfigs[provider];
}

const redirectUriEnvByProvider: Record<OAuthProvider, string> = {
  meta: 'META_OAUTH_REDIRECT_URI',
  instagram: 'INSTAGRAM_OAUTH_REDIRECT_URI',
  tiktok: 'TIKTOK_OAUTH_REDIRECT_URI',
  threads: 'THREADS_OAUTH_REDIRECT_URI',
  pinterest: 'PINTEREST_OAUTH_REDIRECT_URI',
  linkedin: 'LINKEDIN_OAUTH_REDIRECT_URI',
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

export function getClientCredentials(
  provider: OAuthProvider,
  linkedinCredentialKind?: LinkedInCredentialKind,
): { clientId: string; clientSecret: string } {
  const config = getProviderConfig(provider, linkedinCredentialKind);
  // Trim whitespace/newlines — secrets uploaded via `echo "x" | gcloud secrets
  // create` carry a trailing \n, which corrupts Basic Auth headers and authorize
  // URLs (X rejects with "Missing valid authorization header").
  const clientId = (process.env[config.clientIdEnv] || '').trim();
  const clientSecret = (process.env[config.clientSecretEnv] || '').trim();
  if (!clientId || !clientSecret) {
    const suffix = provider === 'linkedin' && linkedinCredentialKind
      ? ` (${linkedinCredentialKind})`
      : '';
    throw new Error(`Missing OAuth credentials for ${provider}${suffix}: ${config.clientIdEnv} and/or ${config.clientSecretEnv}`);
  }
  return { clientId, clientSecret };
}
