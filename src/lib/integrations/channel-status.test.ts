import { describe, expect, it } from 'vitest';
import {
  pickRepresentativeConnection,
  resolveChannelStatus,
  resolveConnectionChipTone,
} from './channel-status';

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

  it('marks Meta connected when a single Page is linked next to a leftover grant', () => {
    // Reconnect / add-account writes a pending `meta` document (no pageId,
    // pageSelectionRequired). Brands with one Page used to stay yellow because
    // the multi-account shortcut required two destinations.
    expect(
      resolveChannelStatus('meta', {
        provider: 'meta',
        scope: 'product',
        status: 'connected',
        pageId: null,
        pageSelectionRequired: true,
        accounts: [
          { destinationId: null, label: null, enabled: true },
          { destinationId: 'page_1', label: 'Café Page', enabled: true },
        ],
      }),
    ).toEqual({ state: 'connected', label: 'Café Page' });
  });

  it('marks Meta connected from several linked Pages even if the grant is still pending', () => {
    expect(
      resolveChannelStatus('meta', {
        provider: 'meta',
        scope: 'product',
        status: 'connected',
        pageSelectionRequired: true,
        accounts: [
          { destinationId: 'page_a', label: 'Page A', enabled: true },
          { destinationId: 'page_b', label: 'Page B', enabled: true },
        ],
      }),
    ).toEqual({ state: 'connected', label: '2 accounts linked' });
  });

  it('ignores disabled leftover destinations when deciding Meta is connected', () => {
    expect(
      resolveChannelStatus('meta', {
        provider: 'meta',
        scope: 'product',
        status: 'connected',
        pageSelectionRequired: true,
        accounts: [
          { destinationId: 'page_old', label: 'Revoked', enabled: false },
        ],
      }),
    ).toEqual({ state: 'needs-page' });
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

describe('resolveConnectionChipTone', () => {
  it('is green when a channel is linked and healthy', () => {
    expect(
      resolveConnectionChipTone('instagram', {
        provider: 'instagram',
        scope: 'product',
        status: 'connected',
        username: 'acme',
        lastRefreshError: null,
      }),
    ).toBe('ready');
  });

  it('is green when Facebook Pages are linked even if the grant leftover asks to pick a page', () => {
    expect(
      resolveConnectionChipTone('meta', {
        provider: 'meta',
        scope: 'product',
        status: 'connected',
        pageSelectionRequired: true,
        lastRefreshError: null,
        accounts: [{ destinationId: 'page_1', label: 'Café Page', enabled: true }],
      }),
    ).toBe('ready');
  });

  it('is amber when a refresh error is present on an otherwise linked channel', () => {
    expect(
      resolveConnectionChipTone('instagram', {
        provider: 'instagram',
        scope: 'product',
        status: 'connected',
        lastRefreshError: 'Token refresh failed',
      }),
    ).toBe('warning');
  });

  it('is amber when Meta is linked but no Page has been chosen', () => {
    expect(
      resolveConnectionChipTone('meta', {
        provider: 'meta',
        scope: 'product',
        status: 'connected',
        pageSelectionRequired: true,
      }),
    ).toBe('warning');
  });

  it('is red when the channel is not linked', () => {
    expect(resolveConnectionChipTone('tiktok', undefined)).toBe('offline');
  });
});

describe('pickRepresentativeConnection', () => {
  it('prefers a connected destination over a pending grant leftover', () => {
    const pending = { status: 'connected', accountKey: null };
    const page = { status: 'connected', accountKey: 'page_1' };
    expect(pickRepresentativeConnection([pending, page])).toEqual(page);
  });

  it('falls back to any connected record, then the first record', () => {
    const pending = { status: 'connected', destinationId: null };
    expect(pickRepresentativeConnection([pending])).toEqual(pending);
    const broken = { status: 'error', accountKey: 'page_1' };
    expect(pickRepresentativeConnection([broken])).toEqual(broken);
  });
});
