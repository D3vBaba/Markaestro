import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMetaManagedPages } from '@/lib/meta-pages';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Route by URL rather than call order: /me/accounts and debug_token are
 * requested concurrently, so a sequential mock would be order-dependent.
 */
function stubGraph(handlers: {
  accounts?: (url: string) => Response;
  debugToken?: () => Response;
  page?: (pageId: string) => Response;
}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/me/accounts')) {
      return handlers.accounts?.(url) ?? jsonResponse({ data: [] });
    }
    if (url.includes('/debug_token')) {
      return handlers.debugToken?.() ?? jsonResponse({ data: { granular_scopes: [] } });
    }
    const pageId = url.split('/').pop()?.split('?')[0] ?? '';
    return handlers.page?.(pageId) ?? jsonResponse({ error: { message: 'not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv('META_APP_ID', 'app-id');
  vi.stubEnv('META_APP_SECRET', 'app-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('fetchMetaManagedPages', () => {
  it('returns Pages from /me/accounts and reports a complete grant', async () => {
    stubGraph({
      accounts: () => jsonResponse({
        data: [{ id: 'page-1', name: 'DripCheckr', access_token: 'page-token' }],
      }),
      debugToken: () => jsonResponse({
        data: { granular_scopes: [{ scope: 'pages_show_list', target_ids: ['page-1'] }] },
      }),
    });

    await expect(fetchMetaManagedPages('user-token')).resolves.toEqual({
      pages: [{ id: 'page-1', name: 'DripCheckr', accessToken: 'page-token' }],
      complete: true,
    });
  });

  it('unions granular asset targets that /me/accounts did not list', async () => {
    stubGraph({
      accounts: () => jsonResponse({
        data: [{ id: 'page-1', name: 'DripCheckr', access_token: 'token-1' }],
      }),
      debugToken: () => jsonResponse({
        data: {
          granular_scopes: [
            { scope: 'pages_show_list', target_ids: ['page-1', 'page-2'] },
            { scope: 'pages_read_engagement', target_ids: ['page-2'] },
          ],
        },
      }),
      page: (pageId) => jsonResponse({ id: pageId, name: 'Second Brand', access_token: 'token-2' }),
    });

    const result = await fetchMetaManagedPages('user-token');

    expect(result.complete).toBe(true);
    expect(result.pages).toEqual([
      { id: 'page-1', name: 'DripCheckr', accessToken: 'token-1' },
      { id: 'page-2', name: 'Second Brand', accessToken: 'token-2' },
    ]);
  });

  it('follows /me/accounts pagination instead of truncating the grant', async () => {
    stubGraph({
      accounts: (url) => (url.includes('after=cursor2')
        ? jsonResponse({ data: [{ id: 'page-2', name: 'Two', access_token: 't2' }] })
        : jsonResponse({
          data: [{ id: 'page-1', name: 'One', access_token: 't1' }],
          paging: { next: 'https://graph.facebook.com/v22.0/me/accounts?after=cursor2' },
        })),
    });

    const result = await fetchMetaManagedPages('user-token');

    expect(result.complete).toBe(true);
    expect(result.pages.map((page) => page.id)).toEqual(['page-1', 'page-2']);
  });

  it('marks the grant incomplete when /me/accounts fails', async () => {
    stubGraph({
      accounts: () => jsonResponse({ error: { message: 'Rate limited' } }, 429),
      debugToken: () => jsonResponse({
        data: { granular_scopes: [{ scope: 'pages_show_list', target_ids: [] }] },
      }),
    });

    const result = await fetchMetaManagedPages('user-token');

    // Never claim a failed read enumerated the whole grant — callers revoke on
    // absence, and that would disconnect healthy Pages.
    expect(result.complete).toBe(false);
    expect(result.error).toMatch(/Rate limited/);
  });

  it('marks the grant incomplete when the asset grant cannot be inspected', async () => {
    stubGraph({
      accounts: () => jsonResponse({
        data: [{ id: 'page-1', name: 'DripCheckr', access_token: 'page-token' }],
      }),
      debugToken: () => jsonResponse({ error: { message: 'Invalid OAuth token' } }, 400),
    });

    const result = await fetchMetaManagedPages('user-token');

    expect(result.complete).toBe(false);
    expect(result.pages.map((page) => page.id)).toEqual(['page-1']);
  });

  it('marks the grant incomplete when app credentials are unavailable', async () => {
    vi.stubEnv('META_APP_ID', '');
    vi.stubEnv('META_APP_SECRET', '');
    stubGraph({
      accounts: () => jsonResponse({
        data: [{ id: 'page-1', name: 'DripCheckr', access_token: 'page-token' }],
      }),
    });

    const result = await fetchMetaManagedPages('user-token');

    expect(result.complete).toBe(false);
    expect(result.pages).toHaveLength(1);
  });
});
