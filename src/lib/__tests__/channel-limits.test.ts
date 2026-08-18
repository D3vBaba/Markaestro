import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';

const getEffectiveLimitsMock = vi.fn();
const listConnectionsMock = vi.fn();

vi.mock('@/lib/stripe/entitlements', () => ({
  getEffectiveLimits: (...args: unknown[]) => getEffectiveLimitsMock(...args),
}));

vi.mock('@/lib/platform/connections', () => ({
  listConnections: (...args: unknown[]) => listConnectionsMock(...args),
}));

import { assertChannelCapacity } from '@/lib/platform/channel-limits';

function conn(
  provider: string,
  accountKey: string | null,
  credentialKey: string | null = null,
): PlatformConnection {
  return {
    provider,
    accountKey,
    credentialKey,
    channels: [],
    capabilities: [],
    status: 'connected',
    accessTokenEncrypted: 'token',
    metadata: {},
    workspaceId: 'ws_1',
    updatedBy: 'user_1',
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
  } as PlatformConnection;
}

function setCap(channelsPerBrand: number) {
  getEffectiveLimitsMock.mockResolvedValue({ tier: 'free', channelsPerBrand });
}

const scope = { uid: 'user_1', workspaceId: 'ws_1', productId: 'prod_1' };

beforeEach(() => {
  getEffectiveLimitsMock.mockReset();
  listConnectionsMock.mockReset();
  listConnectionsMock.mockResolvedValue([]);
});

describe('assertChannelCapacity', () => {
  it('passes without reading connections when the cap is unlimited', async () => {
    setCap(-1);
    await expect(
      assertChannelCapacity({ ...scope, additions: [{ provider: 'tiktok', accountKey: 'open1' }] }),
    ).resolves.toBeUndefined();
    expect(listConnectionsMock).not.toHaveBeenCalled();
  });

  it('allows net-new destinations under the cap and blocks them at the cap', async () => {
    setCap(2);
    listConnectionsMock.mockResolvedValue([conn('tiktok', 'open1')]);
    await expect(
      assertChannelCapacity({ ...scope, additions: [{ provider: 'instagram', accountKey: 'ig1' }] }),
    ).resolves.toBeUndefined();

    listConnectionsMock.mockResolvedValue([conn('tiktok', 'open1'), conn('instagram', 'ig1')]);
    await expect(
      assertChannelCapacity({ ...scope, additions: [{ provider: 'threads', accountKey: 'th1' }] }),
    ).rejects.toThrow('CHANNEL_LIMIT_REACHED');
  });

  it('never blocks re-linking an existing destination, even over the cap', async () => {
    // A downgraded workspace can sit above its cap; reauthorizing what is
    // already connected must keep working.
    setCap(2);
    listConnectionsMock.mockResolvedValue([
      conn('tiktok', 'open1'),
      conn('instagram', 'ig1'),
      conn('threads', 'th1'),
    ]);
    await expect(
      assertChannelCapacity({ ...scope, additions: [{ provider: 'instagram', accountKey: 'ig1' }] }),
    ).resolves.toBeUndefined();
  });

  it('treats a credential as superseded once its provider has a destination', async () => {
    setCap(2);
    // Pinterest board already linked; reconnecting the Pinterest account
    // writes a bare credential document that the display list supersedes.
    listConnectionsMock.mockResolvedValue([
      conn('pinterest', 'board1', 'pin_user'),
      conn('tiktok', 'open1'),
    ]);
    await expect(
      assertChannelCapacity({
        ...scope,
        additions: [{ provider: 'pinterest', credentialKey: 'pin_user' }],
      }),
    ).resolves.toBeUndefined();
  });

  it('counts the first credential of a provider against the cap', async () => {
    setCap(2);
    listConnectionsMock.mockResolvedValue([conn('tiktok', 'open1'), conn('instagram', 'ig1')]);
    await expect(
      assertChannelCapacity({
        ...scope,
        additions: [{ provider: 'pinterest', credentialKey: 'pin_user' }],
      }),
    ).rejects.toThrow('CHANNEL_LIMIT_REACHED');
  });

  it('lets a linked destination replace its own pending credential slot', async () => {
    setCap(2);
    // Linking the first board supersedes the pending credential document, so
    // the displayed channel count does not grow.
    listConnectionsMock.mockResolvedValue([
      conn('pinterest', null, 'pin_user'),
      conn('tiktok', 'open1'),
    ]);
    await expect(
      assertChannelCapacity({
        ...scope,
        additions: [{ provider: 'pinterest', accountKey: 'board1' }],
      }),
    ).resolves.toBeUndefined();
    // ...but linking two boards at once would exceed the cap.
    await expect(
      assertChannelCapacity({
        ...scope,
        additions: [
          { provider: 'pinterest', accountKey: 'board1' },
          { provider: 'pinterest', accountKey: 'board2' },
        ],
      }),
    ).rejects.toThrow('CHANNEL_LIMIT_REACHED');
  });

  it('allows replace-mode swaps that keep the count at the cap', async () => {
    setCap(2);
    listConnectionsMock.mockResolvedValue([
      conn('pinterest', 'board1', 'pin_user'),
      conn('pinterest', 'board2', 'pin_user'),
    ]);
    await expect(
      assertChannelCapacity({
        ...scope,
        additions: [
          { provider: 'pinterest', accountKey: 'board3' },
          { provider: 'pinterest', accountKey: 'board4' },
        ],
        replaceProviders: ['pinterest'],
      }),
    ).resolves.toBeUndefined();
  });

  it('matches destinations through document-id sanitization', async () => {
    setCap(1);
    const urn = 'urn:li:organization:123/extra';
    listConnectionsMock.mockResolvedValue([conn('linkedin_community', urn, 'profile1')]);
    await expect(
      assertChannelCapacity({
        ...scope,
        additions: [{ provider: 'linkedin_community', accountKey: urn }],
      }),
    ).resolves.toBeUndefined();
  });

  it('scopes workspace-level checks to the workspace bucket', async () => {
    setCap(2);
    listConnectionsMock.mockResolvedValue([]);
    await assertChannelCapacity({
      uid: 'user_1',
      workspaceId: 'ws_1',
      additions: [{ provider: 'meta', credentialKey: 'fb_user_1' }],
    });
    expect(listConnectionsMock).toHaveBeenCalledWith('ws_1', undefined);
  });
});
