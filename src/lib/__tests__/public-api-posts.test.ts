import { describe, expect, it } from 'vitest';
import { getDeliveryModeForChannel, serializePublicPost, validatePublicPostInput, validateResolvedPublicPostInput } from '../public-api/posts';

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
    })).toThrow('VALIDATION_INSTAGRAM_REQUIRES_MEDIA');

    expect(() => validatePublicPostInput({
      channel: 'tiktok',
      caption: 'Hello world',
      mediaAssetIds: [],
    })).toThrow('VALIDATION_TIKTOK_REQUIRES_MEDIA');
  });

  it('uses platform-specific media caps', () => {
    expect(() => validatePublicPostInput({
      channel: 'tiktok',
      caption: 'Carousel',
      mediaAssetIds: Array.from({ length: 36 }, (_, idx) => `ast_${idx}`),
    })).toThrow('VALIDATION_TOO_MANY_MEDIA_ASSETS');

    expect(() => validatePublicPostInput({
      channel: 'pinterest',
      caption: 'Pin',
      mediaAssetIds: Array.from({ length: 6 }, (_, idx) => `ast_${idx}`),
    })).toThrow('VALIDATION_TOO_MANY_MEDIA_ASSETS');
  });

  it('uses direct publish mode for all public API channels', () => {
    expect(getDeliveryModeForChannel('facebook')).toBe('direct_publish');
    expect(getDeliveryModeForChannel('instagram')).toBe('direct_publish');
    expect(getDeliveryModeForChannel('tiktok')).toBe('direct_publish');
  });

  it('rejects TikTok posts with multiple videos', () => {
    expect(() => validateResolvedPublicPostInput({
      channel: 'tiktok',
      caption: 'Demo',
      mediaAssetIds: ['ast_1', 'ast_2'],
    }, [
      { id: 'ast_1', url: 'https://example.com/1.mp4', mimeType: 'video/mp4', type: 'video' },
      { id: 'ast_2', url: 'https://example.com/2.mp4', mimeType: 'video/mp4', type: 'video' },
    ])).toThrow('VALIDATION_TIKTOK_MAX_ONE_VIDEO');
  });

  it('rejects TikTok posts that mix one video with images', () => {
    expect(() => validateResolvedPublicPostInput({
      channel: 'tiktok',
      caption: 'Demo',
      mediaAssetIds: ['ast_1', 'ast_2'],
    }, [
      { id: 'ast_1', url: 'https://example.com/1.mp4', mimeType: 'video/mp4', type: 'video' },
      { id: 'ast_2', url: 'https://example.com/2.jpg', mimeType: 'image/jpeg', type: 'image' },
    ])).toThrow('VALIDATION_TIKTOK_VIDEO_CANNOT_BE_COMBINED');
  });

  it('rejects Pinterest videos mixed with other media', () => {
    expect(() => validateResolvedPublicPostInput({
      channel: 'pinterest',
      caption: 'Pin',
      mediaAssetIds: ['ast_1', 'ast_2'],
    }, [
      { id: 'ast_1', url: 'https://example.com/1.mp4', mimeType: 'video/mp4', type: 'video' },
      { id: 'ast_2', url: 'https://example.com/2.jpg', mimeType: 'image/jpeg', type: 'image' },
    ])).toThrow('VALIDATION_PINTEREST_VIDEO_MUST_BE_SINGLE_MEDIA');
  });

  it('serializes content as caption and preserves legacy slideshow metadata on posts', () => {
    const serialized = serializePublicPost({
      id: 'pst_123',
      channel: 'tiktok',
      status: 'exported_for_review',
      content: 'Draft me',
      destinationId: 'tiktok:tiktok:tt_open_123',
      destinationProvider: 'tiktok',
      mediaAssetIds: ['ast_1'],
      mediaUrls: ['https://example.com/1.jpg'],
      nextAction: 'open_tiktok_inbox_and_complete_editing',
      sourceType: 'slideshow',
      slideshowId: 'ss_123',
      slideshowTitle: 'Launch sequence',
      slideshowSlideCount: 6,
      slideshowCoverIndex: 0,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    });

    expect(serialized.caption).toBe('Draft me');
    expect(serialized.destinationId).toBe('tiktok:tiktok:tt_open_123');
    expect(serialized.destinationProvider).toBe('tiktok');
    expect(serialized.nextAction).toBe('open_tiktok_inbox_and_complete_editing');
    expect(serialized.sourceType).toBe('slideshow');
    expect(serialized.slideshowId).toBe('ss_123');
    expect(serialized.slideshowTitle).toBe('Launch sequence');
    expect(serialized.slideshowSlideCount).toBe(6);
    expect(serialized.slideshowCoverIndex).toBe(0);
  });
});
