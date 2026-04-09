import { describe, expect, it } from 'vitest';
import { getDeliveryModeForChannel, serializePublicPost, validatePublicPostInput } from '../public-api/posts';

describe('public post validation', () => {
  it('allows facebook text-only posts', () => {
    expect(() => validatePublicPostInput({
      channel: 'facebook',
      caption: 'Hello world',
      mediaAssetIds: [],
    })).not.toThrow();
  });

  it('rejects facebook posts with neither caption nor media', () => {
    expect(() => validatePublicPostInput({
      channel: 'facebook',
      caption: '',
      mediaAssetIds: [],
    })).toThrow('VALIDATION_FACEBOOK_POST_REQUIRES_CONTENT_OR_MEDIA');
  });

  it('requires media for instagram and tiktok', () => {
    expect(() => validatePublicPostInput({
      channel: 'instagram',
      caption: 'Hello world',
      mediaAssetIds: [],
    })).toThrow('VALIDATION_INSTAGRAM_REQUIRES_IMAGE');

    expect(() => validatePublicPostInput({
      channel: 'tiktok',
      caption: 'Hello world',
      mediaAssetIds: [],
    })).toThrow('VALIDATION_TIKTOK_REQUIRES_IMAGE');
  });

  it('caps media assets at 10 across channels', () => {
    expect(() => validatePublicPostInput({
      channel: 'tiktok',
      caption: 'Carousel',
      mediaAssetIds: Array.from({ length: 11 }, (_, idx) => `ast_${idx}`),
    })).toThrow('VALIDATION_TOO_MANY_MEDIA_ASSETS');
  });

  it('uses user review mode for TikTok only', () => {
    expect(getDeliveryModeForChannel('facebook')).toBe('direct_publish');
    expect(getDeliveryModeForChannel('instagram')).toBe('direct_publish');
    expect(getDeliveryModeForChannel('tiktok')).toBe('user_review');
  });

  it('serializes content as caption', () => {
    const serialized = serializePublicPost({
      id: 'pst_123',
      channel: 'tiktok',
      status: 'exported_for_review',
      content: 'Draft me',
      mediaAssetIds: ['ast_1'],
      mediaUrls: ['https://example.com/1.jpg'],
      nextAction: 'open_tiktok_inbox_and_complete_editing',
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    });

    expect(serialized.caption).toBe('Draft me');
    expect(serialized.nextAction).toBe('open_tiktok_inbox_and_complete_editing');
  });
});
