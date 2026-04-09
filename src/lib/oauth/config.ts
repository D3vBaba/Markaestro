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
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    scopes: [
      'https://www.googleapis.com/auth/adwords',
      'openid',
      'email',
      'profile',
    ],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  },
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    revokeUrl: 'https://open.tiktokapis.com/v2/oauth/revoke/',
    scopes: [
      'user.info.stats',
      'video.list',
      'video.publish',
      'video.upload',
    ],
    clientIdEnv: 'TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
    clientIdParam: 'client_key',
    extraAuthParams: {},
  },
  tiktok_ads: {
    authUrl: 'https://business-api.tiktok.com/portal/auth',
    tokenUrl: 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
    scopes: [],
    clientIdEnv: 'TIKTOK_ADS_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_ADS_CLIENT_SECRET',
    clientIdParam: 'app_id',
    extraAuthParams: {},
  },
};

export function getProviderConfig(provider: OAuthProvider): OAuthProviderConfig {
  return providerConfigs[provider];
}

const redirectUriEnvByProvider: Record<OAuthProvider, string> = {
  meta: 'META_OAUTH_REDIRECT_URI',
  instagram: 'INSTAGRAM_OAUTH_REDIRECT_URI',
  google: 'GOOGLE_OAUTH_REDIRECT_URI',
  tiktok: 'TIKTOK_OAUTH_REDIRECT_URI',
  tiktok_ads: 'TIKTOK_ADS_OAUTH_REDIRECT_URI',
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
