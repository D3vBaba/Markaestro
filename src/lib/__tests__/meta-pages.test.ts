import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMetaManagedPages } from '@/lib/meta-pages';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('fetchMetaManagedPages', () => {
  it('uses /me/accounts when Meta returns managed Pages normally', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'page-1',
            name: 'DripCheckr',
            access_token: 'page-token',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMetaManagedPages('user-token')).resolves.toEqual({
      pages: [
        {
          id: 'page-1',
          name: 'DripCheckr',
          accessToken: 'page-token',
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to granular asset targets for Facebook Login for Business', async () => {
    vi.stubEnv('META_APP_ID', 'app-id');
    vi.stubEnv('META_APP_SECRET', 'app-secret');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            granular_scopes: [
              {
                scope: 'pages_show_list',
                target_ids: ['page-1'],
              },
              {
                scope: 'pages_read_engagement',
                target_ids: ['page-1'],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'page-1',
          name: 'DripCheckr',
          access_token: 'page-token',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMetaManagedPages('user-token')).resolves.toEqual({
      pages: [
        {
          id: 'page-1',
          name: 'DripCheckr',
          accessToken: 'page-token',
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: 'Bearer app-id|app-secret' },
    });
  });
});
