/**
 * Human-readable catalog of every OAuth scope Markaestro requests.
 *
 * The connect dialog shows this list BEFORE sending the user to the
 * platform's login, and the post-connect panel shows which entries were
 * actually granted. The copy lives in `appCommon.connectChannel.permissions`
 * keyed by `key`; this module is pure data so the client can import it.
 *
 * `permission-catalog.test.ts` asserts this list matches the scopes in
 * `src/lib/oauth/config.ts`, so a scope added there without a description
 * here fails the build rather than shipping an undocumented request.
 */

/** Which product feature a scope powers. Drives the "used for" label. */
export type PermissionFeature =
  | 'profile'
  | 'publish'
  | 'insights'
  | 'delete'
  | 'pages'
  | 'boards'
  | 'library';

export type PermissionEntry = {
  /** Scope string exactly as sent to the provider. */
  scope: string;
  /** i18n-safe key (scopes contain dots and colons). */
  key: string;
  feature: PermissionFeature;
  /** Requested only when a server flag is on. Shown when granted, not requested. */
  optional?: boolean;
};

/** Providers a connect dialog can be opened for. LinkedIn splits by kind. */
export type CatalogProvider =
  | 'instagram'
  | 'meta'
  | 'threads'
  | 'tiktok'
  | 'pinterest'
  | 'linkedin_profile'
  | 'linkedin_community';

function entry(scope: string, feature: PermissionFeature, optional = false): PermissionEntry {
  return {
    scope,
    key: scope.replace(/[^a-z0-9]+/gi, '_'),
    feature,
    ...(optional ? { optional: true } : {}),
  };
}

export const PERMISSION_CATALOG: Record<CatalogProvider, PermissionEntry[]> = {
  instagram: [
    entry('instagram_business_basic', 'profile'),
    entry('instagram_business_content_publish', 'publish'),
    entry('instagram_business_manage_insights', 'insights'),
  ],
  meta: [
    entry('pages_show_list', 'pages'),
    entry('pages_read_engagement', 'insights'),
    entry('pages_manage_posts', 'publish'),
    entry('read_insights', 'insights'),
    entry('pages_read_user_content', 'library', true),
  ],
  threads: [
    entry('threads_basic', 'profile'),
    entry('threads_content_publish', 'publish'),
    entry('threads_delete', 'delete'),
    entry('threads_manage_insights', 'insights'),
  ],
  tiktok: [
    entry('user.info.basic', 'profile'),
    entry('user.info.profile', 'profile'),
    entry('video.publish', 'publish'),
    entry('video.upload', 'publish'),
    entry('video.list', 'library'),
    entry('user.info.stats', 'insights'),
  ],
  pinterest: [
    entry('user_accounts:read', 'profile'),
    entry('boards:read', 'boards'),
    entry('boards:write', 'boards'),
    entry('boards:read_secret', 'boards'),
    entry('boards:write_secret', 'boards'),
    entry('pins:read', 'library'),
    entry('pins:write', 'publish'),
    entry('pins:read_secret', 'library'),
    entry('pins:write_secret', 'publish'),
  ],
  linkedin_profile: [
    entry('openid', 'profile'),
    entry('profile', 'profile'),
    entry('w_member_social', 'publish'),
    entry('r_member_postAnalytics', 'insights', true),
    entry('r_member_profileAnalytics', 'insights', true),
  ],
  linkedin_community: [
    entry('r_basicprofile', 'profile'),
    entry('w_organization_social', 'publish'),
    entry('r_organization_social', 'library'),
    entry('rw_organization_admin', 'pages'),
  ],
};

/** Map a UI provider id (plus LinkedIn mode) onto a catalog bucket. */
export function catalogProviderFor(
  provider: string,
  linkedinMode?: 'profile' | 'community' | null,
): CatalogProvider | null {
  if (provider === 'linkedin') {
    return linkedinMode === 'community' ? 'linkedin_community' : 'linkedin_profile';
  }
  if (provider === 'linkedin_profile' || provider === 'linkedin_community') return provider;
  if (provider in PERMISSION_CATALOG) return provider as CatalogProvider;
  return null;
}

/** Scopes the dialog lists up front: everything that is not flag-gated. */
export function requestedPermissions(provider: CatalogProvider): PermissionEntry[] {
  return PERMISSION_CATALOG[provider].filter((item) => !item.optional);
}

/**
 * Split a stored scope string into scopes. Providers disagree on the
 * separator (space per RFC, comma for Instagram/TikTok/Threads), and TikTok
 * has been seen returning a JSON-ish array string, so accept all of them.
 */
export function parseGrantedScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\s,]+/)
    .map((item) => item.replace(/^[\["']+|[\]"']+$/g, '').trim())
    .filter(Boolean);
}

/**
 * Catalog entries that match a granted-scope list. Unknown scopes are
 * dropped: the panel only ever describes what it can explain.
 */
export function grantedPermissions(
  provider: CatalogProvider,
  granted: string[],
): PermissionEntry[] {
  const set = new Set(granted);
  return PERMISSION_CATALOG[provider].filter((item) => set.has(item.scope));
}
