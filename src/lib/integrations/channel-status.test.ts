import { describe, expect, it } from 'vitest';
import { resolveChannelStatus } from './channel-status';

describe('resolveChannelStatus', () => {
  it('treats a missing connection as disconnected', () => {
    expect(resolveChannelStatus('meta', undefined)).toEqual({ state: 'disconnected' });
  });

  it('ignores workspace-scoped leftovers for every provider', () => {
    // This is the bug that made Settings ("not linked") disagree with the
    // product sheet ("connected"): a leftover workspace Meta with a pageId.
    expect(
      resolveChannelStatus('meta', {
        provider: 'meta',
        scope: 'workspace',
        status: 'connected',
        pageId: 'page_1',
      }),
    ).toEqual({ state: 'disconnected' });
    expect(
      resolveChannelStatus('instagram', {
        provider: 'instagram',
        scope: 'workspace',
        status: 'connected',
      }),
    ).toEqual({ state: 'disconnected' });
  });

  it('marks Meta connected only when a Page is chosen', () => {
    expect(
      resolveChannelStatus('meta', {
        provider: 'meta',
        scope: 'product',
        status: 'connected',
        pageId: 'page_1',
        pageName: 'My Page',
      }),
    ).toEqual({ state: 'connected', label: 'My Page' });
  });

  it('marks Meta needs-page when connected without a Page or pending selection', () => {
    expect(
      resolveChannelStatus('meta', {
        provider: 'meta',
        scope: 'product',
        status: 'connected',
        pageId: null,
        pageSelectionRequired: true,
      }),
    ).toEqual({ state: 'needs-page' });
    expect(
      resolveChannelStatus('meta', {
        provider: 'meta',
        scope: 'product',
        status: 'connected',
        pageId: null,
      }),
    ).toEqual({ state: 'needs-page' });
  });

  it('marks a product-scoped Instagram connected with an @username label', () => {
    expect(
      resolveChannelStatus('instagram', {
        provider: 'instagram',
        scope: 'product',
        status: 'connected',
        username: 'acme',
      }),
    ).toEqual({ state: 'connected', label: '@acme' });
  });

  it('treats a non-connected social entry as disconnected', () => {
    expect(
      resolveChannelStatus('threads', {
        provider: 'threads',
        scope: 'product',
        status: 'expired',
      }),
    ).toEqual({ state: 'disconnected' });
  });
});
