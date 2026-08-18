import { describe, expect, it } from 'vitest';
import {
  CONNECT_MAX_DESTINATIONS_PER_REQUEST,
  CONNECT_MAX_MEDIA_ASSETS_PER_POST,
  validateConnectPostFanout,
} from '../public-api/connect-compat';

describe('Connect post fan-out bounds', () => {
  it('accepts the documented bounded batch sizes', () => {
    expect(() => validateConnectPostFanout({
      caption: 'Scheduled post',
      mediaAssetIds: Array.from({ length: CONNECT_MAX_MEDIA_ASSETS_PER_POST }, (_, i) => `asset_${i}`),
      accounts: Array.from({ length: CONNECT_MAX_DESTINATIONS_PER_REQUEST }, (_, i) => `product#meta:facebook:${i}`),
    })).not.toThrow();
  });

  it('rejects destination fan-out above the per-request ceiling', () => {
    expect(() => validateConnectPostFanout({
      caption: '',
      mediaAssetIds: [],
      accounts: Array.from({ length: CONNECT_MAX_DESTINATIONS_PER_REQUEST + 1 }, (_, i) => `account_${i}`),
    })).toThrow('VALIDATION_TOO_MANY_DESTINATIONS');
  });

  it('rejects oversized media lists before performing Firestore reads', () => {
    expect(() => validateConnectPostFanout({
      caption: '',
      mediaAssetIds: Array.from({ length: CONNECT_MAX_MEDIA_ASSETS_PER_POST + 1 }, (_, i) => `asset_${i}`),
      accounts: ['product#meta:facebook:1'],
    })).toThrow('VALIDATION_TOO_MANY_MEDIA_ASSETS');
  });
});
