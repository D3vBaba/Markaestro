import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInstagramGraphUnsupported, isInstagramMethodTypeUnsupported } from '../oauth/instagram-errors';
import { getProviderConfig } from '../oauth/config';
import {
  instagramExtraDataFromTokenResponse,
  normalizeOAuthTokenResponse,
  refreshAccessToken,
} from '../oauth/flow';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('oauth provider config', () => {
  it('requests publishing and insights scopes for Meta-family providers', () => {
    expect(getProviderConfig('instagram').scopes).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_insights',
    ]);
    // Must stay 'false' so the mobile dialog never hands off to the native
    // Facebook/Instagram app — keeps connect in the browser.
    expect(getProviderConfig('instagram').extraAuthParams).toEqual({
      enable_fb_login: 'false',
    });
    expect(getProviderConfig('meta').scopes).toEqual([
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'read_insights',
    ]);
    expect(getProviderConfig('meta').scopes).not.toContain('business_management');
    expect(getProviderConfig('meta').scopes).not.toContain('instagram_basic');
    expect(getProviderConfig('meta').scopes).not.toContain('instagram_content_publish');
    expect(getProviderConfig('meta').scopes).not.toContain('instagram_manage_insights');
    expect(getProviderConfig('meta').scopes).toContain('read_insights');
    expect(getProviderConfig('threads').scopes).toContain('threads_manage_insights');
    expect(getProviderConfig('tiktok').scopes).toContain('video.list');
    expect(getProviderConfig('tiktok').scopes).toContain('user.info.stats');
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

describe('OAuth token refresh resilience', () => {
  function stubTikTokCredentials() {
    vi.stubEnv('TIKTOK_CLIENT_KEY', 'test-client-key');
    vi.stubEnv('TIKTOK_CLIENT_SECRET', 'test-client-secret');
  }

  it('retries a transient provider response before accepting a refreshed token', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubTikTokCredentials();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<html>temporary upstream failure</html>', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_in: 86_400,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const refreshPromise = refreshAccessToken('tiktok', 'old-refresh-token');
    await vi.runAllTimersAsync();

    await expect(refreshPromise).resolves.toEqual(expect.objectContaining({
      accessToken: 'fresh-access-token',
      refreshToken: 'fresh-refresh-token',
      expiresIn: 86_400,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports an empty response without leaking or throwing a JSON parse error', async () => {
    stubTikTokCredentials();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    await expect(refreshAccessToken('tiktok', 'old-refresh-token')).rejects.toThrow(
      'Token refresh failed for tiktok (HTTP 200): provider returned an empty response',
    );
  });

  it('reports provider HTML safely without storing the response body', async () => {
    stubTikTokCredentials();
    const providerBody = '<html>proxy failure with internal details</html>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(providerBody, { status: 200 })));

    const error = await refreshAccessToken('tiktok', 'old-refresh-token').catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'Token refresh failed for tiktok (HTTP 200): provider returned a non-JSON response',
    );
    expect((error as Error).message).not.toContain(providerBody);
  });
});
