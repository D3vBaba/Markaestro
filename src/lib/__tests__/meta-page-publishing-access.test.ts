import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPagePublishingAccess } from '@/lib/platform/meta-graph-api';

function graphError(code: number, message: string, status = 403) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function graphOk(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('checkPagePublishingAccess', () => {
  it('allows publishing when the Page tasks cannot be read', async () => {
    // Reading `tasks` needs pages_read_engagement/pages_show_list; publishing
    // needs pages_manage_posts. Failing this read says nothing about the latter,
    // and blocking here turned healthy Pages into failed scheduled posts.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(graphError(
      10,
      'Any of the pages_read_engagement, pages_manage_metadata, pages_read_user_content, ' +
      'pages_manage_ads, pages_show_list or pages_messaging permission(s) must be granted',
    )));

    await expect(checkPagePublishingAccess('page-token', 'page_1')).resolves.toEqual({
      canPublish: true,
    });
  });

  it('blocks publishing on an invalid or expired token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      graphError(190, 'Error validating access token: Session has expired', 401),
    ));

    const result = await checkPagePublishingAccess('stale-token', 'page_1');

    expect(result.canPublish).toBe(false);
    expect(result.error).toMatch(/Session has expired/);
  });

  it('allows publishing when the Page reports publishing tasks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      graphOk({ id: 'page_1', name: 'Page One', tasks: ['MANAGE', 'CREATE_CONTENT'] }),
    ));

    await expect(checkPagePublishingAccess('page-token', 'page_1')).resolves.toEqual({
      canPublish: true,
    });
  });

  it('reports Page Publishing Authorization when publishing tasks are absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      graphOk({ id: 'page_1', name: 'Page One', tasks: ['ANALYZE'] }),
    ));

    const result = await checkPagePublishingAccess('page-token', 'page_1');
    expect(result.canPublish).toBe(false);
  });
});
