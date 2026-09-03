import { describe, expect, it } from 'vitest';
import { getProviderConfig } from './config';
import {
  PERMISSION_CATALOG,
  catalogProviderFor,
  grantedPermissions,
  parseGrantedScopes,
  requestedPermissions,
  type CatalogProvider,
} from './permission-catalog';
import en from '@/messages/en/appCommon.json';

const CONFIG_BY_CATALOG: Record<CatalogProvider, () => string[]> = {
  instagram: () => getProviderConfig('instagram').scopes,
  meta: () => getProviderConfig('meta').scopes,
  threads: () => getProviderConfig('threads').scopes,
  tiktok: () => getProviderConfig('tiktok').scopes,
  x: () => getProviderConfig('x').scopes,
  pinterest: () => getProviderConfig('pinterest').scopes,
  linkedin_profile: () => getProviderConfig('linkedin', 'profile').scopes,
  linkedin_community: () => getProviderConfig('linkedin', 'community').scopes,
};

describe('permission catalog', () => {
  it('describes every scope the OAuth config requests', () => {
    for (const [provider, scopesOf] of Object.entries(CONFIG_BY_CATALOG)) {
      const catalogScopes = new Set(PERMISSION_CATALOG[provider as CatalogProvider].map((p) => p.scope));
      for (const scope of scopesOf()) {
        expect(catalogScopes.has(scope), `${provider}: ${scope} has no catalog entry`).toBe(true);
      }
    }
  });

  it('requests exactly the non-optional scopes with server flags off', () => {
    // Flag-gated scopes (pages_read_user_content, LinkedIn member analytics)
    // are optional in the catalog and absent from config unless enabled.
    for (const [provider, scopesOf] of Object.entries(CONFIG_BY_CATALOG)) {
      const requested = requestedPermissions(provider as CatalogProvider).map((p) => p.scope).sort();
      const configured = scopesOf()
        .filter((scope) => !PERMISSION_CATALOG[provider as CatalogProvider].find((p) => p.scope === scope)?.optional)
        .sort();
      expect(requested, provider).toEqual(configured);
    }
  });

  it('has English copy for every catalog entry and feature', () => {
    const copy = en.connectChannel as {
      permissions: Record<string, { title: string; description: string }>;
      features: Record<string, string>;
      requirements: Record<string, Record<string, string>>;
      hosts: Record<string, string>;
    };
    for (const [provider, entries] of Object.entries(PERMISSION_CATALOG)) {
      expect(copy.requirements[provider], `requirements.${provider}`).toBeDefined();
      for (const item of entries) {
        expect(copy.permissions[item.key]?.title, `permissions.${item.key}.title`).toBeTruthy();
        expect(copy.permissions[item.key]?.description, `permissions.${item.key}.description`).toBeTruthy();
        expect(copy.features[item.feature], `features.${item.feature}`).toBeTruthy();
      }
    }
  });

  it('maps UI provider ids onto catalog buckets', () => {
    expect(catalogProviderFor('instagram')).toBe('instagram');
    expect(catalogProviderFor('linkedin')).toBe('linkedin_profile');
    expect(catalogProviderFor('linkedin', 'community')).toBe('linkedin_community');
    expect(catalogProviderFor('linkedin_community')).toBe('linkedin_community');
    expect(catalogProviderFor('x')).toBe('x');
    expect(catalogProviderFor('youtube')).toBeNull();
  });

  it('parses comma, space, and array-ish scope strings', () => {
    expect(parseGrantedScopes('instagram_business_basic,instagram_business_content_publish'))
      .toEqual(['instagram_business_basic', 'instagram_business_content_publish']);
    expect(parseGrantedScopes('openid profile w_member_social'))
      .toEqual(['openid', 'profile', 'w_member_social']);
    expect(parseGrantedScopes('["user.info.basic","video.publish"]'))
      .toEqual(['user.info.basic', 'video.publish']);
    expect(parseGrantedScopes(['a', 'b'])).toEqual(['a', 'b']);
    expect(parseGrantedScopes(null)).toEqual([]);
  });

  it('only reports granted scopes it can describe', () => {
    const granted = grantedPermissions('instagram', ['instagram_business_basic', 'made_up']);
    expect(granted.map((p) => p.scope)).toEqual(['instagram_business_basic']);
  });
});
