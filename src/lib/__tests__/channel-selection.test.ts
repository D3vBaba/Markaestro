import { describe, expect, it } from 'vitest';
import { reconcileReadyChannelSelection } from '../social/channel-selection';

describe('reconcileReadyChannelSelection', () => {
  it('removes a stale default Facebook target when Facebook is not ready', () => {
    const result = reconcileReadyChannelSelection('facebook', ['facebook', 'tiktok'], [
      { channel: 'facebook', state: 'needs_setup' },
      { channel: 'tiktok', state: 'ready' },
      { channel: 'instagram', state: 'disconnected' },
    ]);

    expect(result).toEqual({
      selectedChannels: ['tiktok'],
      channel: 'tiktok',
    });
  });

  it('selects the first ready channel when all saved selections are unavailable', () => {
    const result = reconcileReadyChannelSelection('facebook', ['facebook'], [
      { channel: 'facebook', state: 'needs_setup' },
      { channel: 'threads', state: 'ready' },
      { channel: 'tiktok', state: 'ready' },
    ]);

    expect(result).toEqual({
      selectedChannels: ['threads'],
      channel: 'threads',
    });
  });

  it('returns an empty selection when no channel is ready', () => {
    const result = reconcileReadyChannelSelection('facebook', ['facebook'], [
      { channel: 'facebook', state: 'needs_setup' },
      { channel: 'tiktok', state: 'disconnected' },
    ]);

    expect(result).toEqual({
      selectedChannels: [],
      channel: 'facebook',
    });
  });
});
