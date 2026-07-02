import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithRetryMock = vi.fn();

vi.mock('@/lib/fetch-retry', () => ({
  fetchWithRetry: fetchWithRetryMock,
}));

describe('LinkedIn API helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('discovers a profile and approved organization publishing destinations', async () => {
    fetchWithRetryMock.mockImplementation(async (url: string) => {
      if (url.includes('/v2/me')) {
        return new Response(JSON.stringify({
          id: 'person_123',
          localizedFirstName: 'Pat',
          localizedLastName: 'Publisher',
        }), { status: 200 });
      }
      if (url.includes('/organizationAcls')) {
        return new Response(JSON.stringify({
          elements: [
            {
              role: 'ADMINISTRATOR',
              organization: 'urn:li:organization:2414183',
              state: 'APPROVED',
            },
            {
              role: 'ANALYST',
              organization: 'urn:li:organization:999',
              state: 'APPROVED',
            },
          ],
          paging: { count: 100, start: 0 },
        }), { status: 200 });
      }
      if (url.includes('/rest/organizations/2414183')) {
        return new Response(JSON.stringify({
          id: 2414183,
          localizedName: 'Acme LinkedIn',
          vanityName: 'acme',
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { discoverLinkedInDestinations } = await import('../platform/linkedin-api');
    const discovery = await discoverLinkedInDestinations(
      'access_token',
      'r_basicprofile rw_organization_admin w_member_social w_organization_social',
    );

    expect(discovery.profile).toEqual(expect.objectContaining({
      id: 'person_123',
      urn: 'urn:li:person:person_123',
      type: 'profile',
      name: 'Pat Publisher',
    }));
    expect(discovery.pages).toEqual([
      expect.objectContaining({
        id: '2414183',
        urn: 'urn:li:organization:2414183',
        type: 'page',
        name: 'Acme LinkedIn',
        role: 'ADMINISTRATOR',
        vanityName: 'acme',
      }),
    ]);
  });

  it('keeps profile discovery usable when Page discovery is not authorized', async () => {
    fetchWithRetryMock.mockImplementation(async (url: string) => {
      if (url.includes('/v2/me')) {
        return new Response(JSON.stringify({ id: 'person_123', localizedFirstName: 'Pat' }), { status: 200 });
      }
      if (url.includes('/organizationAcls')) {
        return new Response(JSON.stringify({ message: 'Access denied' }), { status: 403 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { discoverLinkedInDestinations } = await import('../platform/linkedin-api');
    const discovery = await discoverLinkedInDestinations('access_token', 'rw_organization_admin');

    expect(discovery.profile.id).toBe('person_123');
    expect(discovery.pages).toEqual([]);
    expect(discovery.pageDiscoveryError).toContain('LinkedIn API error (403)');
  });
});
