import { describe, expect, it } from 'vitest';
import { assertPublicPostDeletable, assertPublicPostInBrandScope, getDeliveryModeForChannel, getPublicPostInitialState, resolvePublicPostBrandScope, resolveRequestedDeliveryMode, serializePublicPost, validatePublicPostInput, validateResolvedPublicPostInput } from '../public-api/posts';
import { getConnectScheduledDeliveryMode, resolveConnectSchedule } from '../public-api/connect-compat';

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

  it('defaults Meta and TikTok posts to manual reminder, everything else to direct publish', () => {
    expect(getDeliveryModeForChannel('facebook')).toBe('manual_reminder');
    expect(getDeliveryModeForChannel('instagram')).toBe('manual_reminder');
    expect(getDeliveryModeForChannel('tiktok')).toBe('manual_reminder');
    expect(getDeliveryModeForChannel('threads')).toBe('direct_publish');
    expect(getDeliveryModeForChannel('linkedin')).toBe('direct_publish');
    expect(getDeliveryModeForChannel('pinterest')).toBe('direct_publish');
  });

  it('lets clients opt into API publishing per post', () => {
    expect(resolveRequestedDeliveryMode('instagram')).toBe('manual_reminder');
    expect(resolveRequestedDeliveryMode('instagram', 'direct_publish')).toBe('direct_publish');
    expect(resolveRequestedDeliveryMode('linkedin', 'manual_reminder')).toBe('manual_reminder');
    // Without Direct Post settings, TikTok's only API-publishing path is the
    // inbox handoff, so a direct-publish opt-in maps onto it.
    expect(resolveRequestedDeliveryMode('tiktok', 'direct_publish')).toBe('platform_inbox');
    expect(resolveRequestedDeliveryMode('tiktok', 'platform_inbox')).toBe('platform_inbox');
  });

  it('reports a TikTok Direct Post as direct publishing', () => {
    // Direct Post lands on the creator's profile, so it is not an inbox
    // hand-off and must not be reported as one.
    const directPost = { __type: 'tiktok', postMode: 'direct_post' } as const;
    expect(resolveRequestedDeliveryMode('tiktok', 'direct_publish', directPost)).toBe('direct_publish');

    const inbox = { __type: 'tiktok', postMode: 'inbox' } as const;
    expect(resolveRequestedDeliveryMode('tiktok', 'direct_publish', inbox)).toBe('platform_inbox');
    // An explicit inbox request wins regardless of the settings attached.
    expect(resolveRequestedDeliveryMode('tiktok', 'platform_inbox', directPost)).toBe('platform_inbox');
  });

  it('rejects the platform inbox mode on channels without an inbox handoff', () => {
    expect(() => resolveRequestedDeliveryMode('facebook', 'platform_inbox'))
      .toThrow('VALIDATION_DELIVERY_MODE_NOT_SUPPORTED_FOR_CHANNEL');
  });

  it('creates public API posts as drafts even when a schedule is supplied', () => {
    expect(getPublicPostInitialState()).toEqual({ status: 'draft', scheduledAt: null });
    expect(getPublicPostInitialState('2026-06-20T17:00:00.000Z')).toEqual({ status: 'draft', scheduledAt: null });
  });

  it('honors explicit Connect schedules while keeping ordinary creates draft-first', () => {
    expect(resolveConnectSchedule('2026-07-12T21:15:00.000Z', true)).toBeNull();
    expect(resolveConnectSchedule('2026-07-12T21:15:00.000Z', undefined)).toBeNull();
    expect(resolveConnectSchedule(null, false)).toBeNull();
    expect(resolveConnectSchedule('2026-07-12T21:15:00Z', false)).toBe('2026-07-12T21:15:00.000Z');
    expect(() => resolveConnectSchedule('not-a-date', false)).toThrow('VALIDATION_INVALID_SCHEDULED_AT');
    expect(getConnectScheduledDeliveryMode('tiktok')).toBe('platform_inbox');
    expect(getConnectScheduledDeliveryMode('instagram')).toBe('direct_publish');
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
      status: 'platform_action_required',
      content: 'Draft me',
      destinationId: 'tiktok:tiktok:tt_open_123',
      destinationProvider: 'tiktok',
      mediaAssetIds: ['ast_1'],
      mediaUrls: ['https://example.com/1.jpg'],
      nextAction: 'open_tiktok_inbox_and_complete_posting',
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
    expect(serialized.nextAction).toBe('open_tiktok_inbox_and_complete_posting');
    expect(serialized.sourceType).toBe('slideshow');
    expect(serialized.slideshowId).toBe('ss_123');
    expect(serialized.slideshowTitle).toBe('Launch sequence');
    expect(serialized.slideshowSlideCount).toBe(6);
    expect(serialized.slideshowCoverIndex).toBe(0);
  });
});

describe('brand scoping', () => {
  it('lets an unbound workspace key filter by any brand, or none', () => {
    expect(resolvePublicPostBrandScope(undefined, 'prod_a')).toBe('prod_a');
    expect(resolvePublicPostBrandScope(undefined, undefined)).toBeUndefined();
    // An empty ?productId= is "no filter", not a brand named "".
    expect(resolvePublicPostBrandScope(undefined, '')).toBeUndefined();
  });

  it('pins a brand-bound key to its own brand', () => {
    expect(resolvePublicPostBrandScope('prod_a', undefined)).toBe('prod_a');
    expect(resolvePublicPostBrandScope('prod_a', 'prod_a')).toBe('prod_a');
  });

  it('refuses a brand-bound key asking for another brand', () => {
    expect(() => resolvePublicPostBrandScope('prod_a', 'prod_b')).toThrow('FORBIDDEN');
  });

  it('hides another brand post from a brand-bound key as NOT_FOUND', () => {
    expect(() => assertPublicPostInBrandScope({ productId: 'prod_b' }, 'prod_a'))
      .toThrow('NOT_FOUND');
    expect(() => assertPublicPostInBrandScope({}, 'prod_a')).toThrow('NOT_FOUND');
  });

  it('allows a brand-bound key its own brand, and an unbound key anything', () => {
    expect(() => assertPublicPostInBrandScope({ productId: 'prod_a' }, 'prod_a')).not.toThrow();
    expect(() => assertPublicPostInBrandScope({ productId: 'prod_b' }, undefined)).not.toThrow();
  });
});

describe('post deletion guards', () => {
  it('refuses to delete a post already handed to the publisher', () => {
    expect(() => assertPublicPostDeletable({ status: 'publishing' }))
      .toThrow('VALIDATION_POST_IS_PUBLISHING');
  });

  it('allows deleting posts in every settled state', () => {
    for (const status of ['draft', 'scheduled', 'published', 'failed', 'partial_failed']) {
      expect(() => assertPublicPostDeletable({ status })).not.toThrow();
    }
  });
});
