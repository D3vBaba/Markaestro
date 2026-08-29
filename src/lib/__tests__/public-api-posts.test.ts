import { describe, expect, it } from 'vitest';
import { assertPublicPostDeletable, assertSchedulableDeliveryMode, collectPublicPostTargetIssues, normalizePublicPostTargets, raisePublicPostTargetIssues, assertPublicPostInBrandScope, getDeliveryModeForChannel, getPublicPostInitialState, resolvePublicPostBrandScope, resolveRequestedDeliveryMode, serializePublicPost, validatePublicPostInput, validateResolvedPublicPostInput } from '../public-api/posts';
import { getConnectDeliveryMode, resolveConnectSchedule } from '../public-api/connect-compat';
import { ApiValidationError } from '../api-response';
import { createPublicPostSchema } from '../public-api/schemas';

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

  it('creates public API posts as drafts when no schedule is supplied', () => {
    expect(getPublicPostInitialState()).toEqual({ status: 'draft', scheduledAt: null });
    expect(getPublicPostInitialState(null)).toEqual({ status: 'draft', scheduledAt: null });
  });

  it('honours a supplied schedule instead of silently discarding it', () => {
    // The schema validated `scheduledAt`, the create dropped it, and the
    // response echoed `scheduledAt: null` with no warning. Accepting a field
    // and discarding it is the one behaviour that cannot be debugged from
    // outside the server.
    expect(getPublicPostInitialState('2026-06-20T17:00:00.000Z')).toEqual({
      status: 'scheduled',
      scheduledAt: '2026-06-20T17:00:00.000Z',
    });
  });

  it('normalizes a schedule to ISO 8601, matching what Connect stores', () => {
    expect(getPublicPostInitialState('2026-06-20T17:00:00Z').scheduledAt)
      .toBe('2026-06-20T17:00:00.000Z');
  });

  it('rejects an unparseable schedule rather than storing garbage', () => {
    expect(() => getPublicPostInitialState('next tuesday')).toThrow('VALIDATION_INVALID_SCHEDULED_AT');
  });

  it('honors explicit Connect schedules while keeping ordinary creates draft-first', () => {
    expect(resolveConnectSchedule('2026-07-12T21:15:00.000Z', true)).toBeNull();
    expect(resolveConnectSchedule('2026-07-12T21:15:00.000Z', undefined)).toBeNull();
    expect(resolveConnectSchedule(null, false)).toBeNull();
    expect(resolveConnectSchedule('2026-07-12T21:15:00Z', false)).toBe('2026-07-12T21:15:00.000Z');
    expect(() => resolveConnectSchedule('not-a-date', false)).toThrow('VALIDATION_INVALID_SCHEDULED_AT');
    expect(getConnectDeliveryMode('tiktok')).toBe('platform_inbox');
    expect(getConnectDeliveryMode('instagram')).toBe('direct_publish');
    expect(getConnectDeliveryMode('facebook')).toBe('direct_publish');
  });

  it('names the channel and its limit when a post carries too much media', () => {
    let thrown: unknown;
    try {
      validatePublicPostInput({
        channel: 'instagram',
        caption: 'Carousel',
        mediaAssetIds: Array.from({ length: 12 }, (_, i) => `ast_${i}`),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiValidationError);
    const error = thrown as ApiValidationError;
    expect(error.message).toBe('VALIDATION_TOO_MANY_MEDIA_ASSETS');
    expect(error.userMessage).toBe('Instagram allows a maximum of 10 media items per post. This post has 12.');
    expect(error.details).toEqual({
      field: 'mediaAssetIds',
      channel: 'instagram',
      limit: 10,
      received: 12,
    });
  });

  it('accepts a full 10-image Instagram carousel', () => {
    expect(() => validatePublicPostInput({
      channel: 'instagram',
      caption: 'Carousel',
      mediaAssetIds: Array.from({ length: 10 }, (_, i) => `ast_${i}`),
    })).not.toThrow();
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

describe('scheduling through the public API', () => {
  it('requires an explicit delivery mode when scheduling a manual-default channel', () => {
    // Meta and TikTok default to manual_reminder on this surface. A scheduled
    // manual reminder is coherent but is almost certainly not what a client
    // sending scheduledAt expects, and guessing is silent either way.
    for (const channel of ['facebook', 'instagram', 'tiktok'] as const) {
      expect(() => assertSchedulableDeliveryMode({
        channel,
        scheduledAt: '2026-06-20T17:00:00.000Z',
      })).toThrow('VALIDATION_SCHEDULED_DELIVERY_MODE_REQUIRED');
    }
  });

  it('accepts a scheduled manual-default channel once the client says which it means', () => {
    for (const deliveryMode of ['direct_publish', 'manual_reminder'] as const) {
      expect(() => assertSchedulableDeliveryMode({
        channel: 'instagram',
        scheduledAt: '2026-06-20T17:00:00.000Z',
        deliveryMode,
      })).not.toThrow();
    }
  });

  it('leaves channels that already default to direct publish alone', () => {
    for (const channel of ['linkedin', 'threads', 'pinterest'] as const) {
      expect(() => assertSchedulableDeliveryMode({
        channel,
        scheduledAt: '2026-06-20T17:00:00.000Z',
      })).not.toThrow();
    }
  });

  it('asks nothing extra of a draft', () => {
    expect(() => assertSchedulableDeliveryMode({ channel: 'instagram' })).not.toThrow();
    expect(() => assertSchedulableDeliveryMode({ channel: 'instagram', scheduledAt: null })).not.toThrow();
  });
});

describe('multi-channel targets', () => {
  it('treats `channel` as the one-target shorthand', () => {
    expect(normalizePublicPostTargets({
      channel: 'instagram',
      caption: 'hi',
      mediaAssetIds: [],
      destinationId: 'dest_1',
      deliveryMode: 'direct_publish',
    })).toEqual([{
      channel: 'instagram',
      destinationId: 'dest_1',
      deliveryMode: 'direct_publish',
      settings: undefined,
    }]);
  });

  it('passes `targets` through unchanged', () => {
    const targets = [
      { channel: 'instagram' as const, destinationId: 'a' },
      { channel: 'linkedin' as const },
    ];
    expect(normalizePublicPostTargets({ targets, caption: 'hi', mediaAssetIds: [] }))
      .toEqual(targets);
  });

  it('reports every failing target at once, not just the first', () => {
    // A caller posting to two channels wants both objections in one response.
    // Stopping at the first made it a two-round-trip conversation.
    const issues = [
      ...collectPublicPostTargetIssues({ channel: 'pinterest', caption: 'x', mediaAssetIds: [] }),
      ...collectPublicPostTargetIssues({ channel: 'linkedin', caption: '', mediaAssetIds: [] }),
    ];
    expect(issues.map((i) => i.channel)).toEqual(['pinterest', 'linkedin']);
    expect(issues.map((i) => i.code)).toEqual([
      'VALIDATION_PINTEREST_REQUIRES_MEDIA',
      'VALIDATION_LINKEDIN_POST_REQUIRES_CONTENT',
    ]);
  });

  it('names both numbers when a target exceeds its media ceiling', () => {
    const [only] = collectPublicPostTargetIssues({
      channel: 'instagram',
      caption: 'x',
      mediaAssetIds: Array.from({ length: 12 }, (_, i) => `m${i}`),
    });
    expect(only.code).toBe('VALIDATION_TOO_MANY_MEDIA_ASSETS');
    expect(only.message).toContain('10');
    expect(only.message).toContain('12');
    expect(only.details).toMatchObject({ limit: 10, received: 12 });
  });

  it('keeps the single-code error shape for a one-target request', () => {
    // A generation of clients branches on `error` being exactly the channel
    // code. Turning that into VALIDATION_ERROR would break them for no gain.
    try {
      raisePublicPostTargetIssues(
        collectPublicPostTargetIssues({ channel: 'linkedin', caption: '', mediaAssetIds: [] }),
        true,
      );
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiValidationError);
      expect((error as ApiValidationError).message).toBe('VALIDATION_LINKEDIN_POST_REQUIRES_CONTENT');
    }
  });

  it('uses the issue list for a multi-target request', () => {
    // There is no single code that can describe two channels failing for two
    // different reasons.
    try {
      raisePublicPostTargetIssues(
        [
          ...collectPublicPostTargetIssues({ channel: 'pinterest', caption: 'x', mediaAssetIds: [] }),
          ...collectPublicPostTargetIssues({ channel: 'linkedin', caption: '', mediaAssetIds: [] }),
        ],
        false,
      );
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as ApiValidationError).message).toBe('VALIDATION_ERROR');
      const issues = (error as ApiValidationError).details.issues as Array<{ channel: string }>;
      expect(issues.map((i) => i.channel)).toEqual(['pinterest', 'linkedin']);
    }
  });

  it('reads back a legacy single-channel post as a one-entry target list', () => {
    // Posts written before `targetChannels` existed must not read back with
    // an empty target list.
    expect(serializePublicPost({
      id: 'p1',
      channel: 'instagram',
      destinationId: 'dest_1',
      deliveryMode: 'manual_reminder',
    }).targets).toEqual([
      { channel: 'instagram', destinationId: 'dest_1', deliveryMode: 'manual_reminder' },
    ]);
  });

  it('reads back a multi-channel post from the per-channel maps', () => {
    expect(serializePublicPost({
      id: 'p1',
      channel: 'instagram',
      targetChannels: ['instagram', 'linkedin'],
      channelDestinations: { instagram: 'ig_1', linkedin: 'li_1' },
      channelDeliveryModes: { instagram: 'manual_reminder', linkedin: 'direct_publish' },
    }).targets).toEqual([
      { channel: 'instagram', destinationId: 'ig_1', deliveryMode: 'manual_reminder' },
      { channel: 'linkedin', destinationId: 'li_1', deliveryMode: 'direct_publish' },
    ]);
  });
});

describe('createPublicPostSchema target shapes', () => {
  it('rejects a request that names neither a channel nor targets', () => {
    expect(() => createPublicPostSchema.parse({ caption: 'hi' })).toThrow();
  });

  it('rejects sending both, rather than silently picking one', () => {
    expect(() => createPublicPostSchema.parse({
      channel: 'instagram',
      targets: [{ channel: 'linkedin' }],
      caption: 'hi',
    })).toThrow();
  });

  it('rejects the same channel twice in targets', () => {
    expect(() => createPublicPostSchema.parse({
      targets: [{ channel: 'linkedin' }, { channel: 'linkedin' }],
      caption: 'hi',
    })).toThrow();
  });

  it('accepts a well-formed multi-target request', () => {
    const parsed = createPublicPostSchema.parse({
      targets: [{ channel: 'linkedin' }, { channel: 'threads' }],
      caption: 'hi',
    });
    expect(parsed.targets?.map((t) => t.channel)).toEqual(['linkedin', 'threads']);
    expect(parsed.channel).toBeUndefined();
  });
});
