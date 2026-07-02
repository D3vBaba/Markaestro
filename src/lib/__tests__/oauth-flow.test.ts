import { describe, expect, it } from 'vitest';
import { isInstagramGraphUnsupported, isInstagramMethodTypeUnsupported } from '../oauth/instagram-errors';
import { getProviderConfig } from '../oauth/config';
import { instagramExtraDataFromTokenResponse, normalizeOAuthTokenResponse } from '../oauth/flow';

describe('oauth provider config', () => {
  it('requests publishing-only Instagram scopes', () => {
    expect(getProviderConfig('instagram').scopes).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
    ]);
    // Must stay 'false' so the mobile dialog never hands off to the native
    // Facebook/Instagram app — keeps connect in the browser.
    expect(getProviderConfig('instagram').extraAuthParams).toEqual({
      enable_fb_login: 'false',
    });
    expect(getProviderConfig('meta').scopes).not.toContain('instagram_manage_insights');
    expect(getProviderConfig('threads').scopes).not.toContain('threads_manage_insights');
  });

  it('uses separate LinkedIn OAuth credentials for profile and community flows', () => {
    expect(getProviderConfig('linkedin', 'profile')).toEqual(expect.objectContaining({
      clientIdEnv: 'LINKEDIN_PROFILE_CLIENT_ID',
      clientSecretEnv: 'LINKEDIN_PROFILE_CLIENT_SECRET',
      scopes: expect.arrayContaining(['openid', 'profile', 'w_member_social']),
    }));
    expect(getProviderConfig('linkedin', 'profile').scopes).not.toContain('w_organization_social');

    expect(getProviderConfig('linkedin', 'community')).toEqual(expect.objectContaining({
      clientIdEnv: 'LINKEDIN_COMMUNITY_CLIENT_ID',
      clientSecretEnv: 'LINKEDIN_COMMUNITY_CLIENT_SECRET',
      scopes: expect.arrayContaining(['r_basicprofile', 'w_organization_social', 'rw_organization_admin']),
    }));
    expect(getProviderConfig('linkedin', 'community').scopes).not.toContain('w_member_social');
  });
});

describe('normalizeOAuthTokenResponse', () => {
  it('supports the documented Instagram Business Login data array response', () => {
    const token = normalizeOAuthTokenResponse('instagram', {
      data: [
        {
          access_token: 'short_ig_token',
          user_id: 'ig_user_123',
          permissions: 'instagram_business_basic,instagram_business_content_publish',
        },
      ],
    });

    expect(token).toEqual({
      access_token: 'short_ig_token',
      user_id: 'ig_user_123',
      permissions: 'instagram_business_basic,instagram_business_content_publish',
    });
  });

  it('stores numeric Instagram user ids returned by Meta as string account ids', () => {
    const token = normalizeOAuthTokenResponse('instagram', {
      access_token: 'short_ig_token',
      user_id: 17841400000000000,
      permissions: 'instagram_business_basic,instagram_business_content_publish',
    });

    expect(instagramExtraDataFromTokenResponse(token)).toEqual({
      igAccountId: '17841400000000000',
      instagramPermissions: 'instagram_business_basic,instagram_business_content_publish',
    });
  });

  it('preserves the top-level response shape used by other OAuth providers', () => {
    const token = normalizeOAuthTokenResponse('tiktok', {
      access_token: 'token',
      refresh_token: 'refresh',
    });

    expect(token).toEqual({
      access_token: 'token',
      refresh_token: 'refresh',
    });
  });
});

describe('instagram graph error handling', () => {
  it('does not classify method-type errors as account eligibility failures', () => {
    const error = {
      error: {
        message: 'Unsupported request - method type: get',
        type: 'IGApiException',
        code: 100,
      },
    };

    expect(isInstagramMethodTypeUnsupported(error, 'get')).toBe(true);
    expect(isInstagramGraphUnsupported(error)).toBe(false);
  });
});
