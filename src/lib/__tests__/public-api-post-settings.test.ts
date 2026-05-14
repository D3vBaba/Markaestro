import { describe, expect, it } from 'vitest';
import {
  assertSettingsMatchesChannel,
  asTikTokSettings,
  asInstagramSettings,
  asYouTubeSettings,
  postSettingsSchema,
} from '../public-api/post-settings';
import { createPublicPostSchema, createPublicPostsBatchSchema } from '../public-api/schemas';

describe('postSettingsSchema', () => {
  it('parses valid TikTok settings', () => {
    const result = postSettingsSchema.parse({
      __type: 'tiktok',
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      disableComment: false,
      photoCoverIndex: 2,
    });
    expect(result.__type).toBe('tiktok');
  });

  it('parses valid Instagram settings', () => {
    const result = postSettingsSchema.parse({
      __type: 'instagram',
      postType: 'reel',
      collaborators: ['alice', 'bob'],
      altText: ['cover image', 'detail shot'],
    });
    expect(result.__type).toBe('instagram');
  });

  it('parses valid YouTube settings', () => {
    const result = postSettingsSchema.parse({
      __type: 'youtube',
      title: 'My video',
      categoryId: '22',
      privacyStatus: 'unlisted',
      madeForKids: false,
      thumbnailUrl: 'https://example.com/thumb.jpg',
    });
    expect(result.__type).toBe('youtube');
  });

  it('rejects unknown __type', () => {
    expect(() => postSettingsSchema.parse({ __type: 'reddit' })).toThrow();
  });

  it('rejects non-numeric YouTube categoryId', () => {
    expect(() => postSettingsSchema.parse({
      __type: 'youtube',
      categoryId: 'gaming',
    })).toThrow();
  });

  it('caps IG collaborators at 3', () => {
    expect(() => postSettingsSchema.parse({
      __type: 'instagram',
      collaborators: ['a', 'b', 'c', 'd'],
    })).toThrow();
  });
});

describe('assertSettingsMatchesChannel', () => {
  it('passes when settings.__type equals channel', () => {
    expect(() => assertSettingsMatchesChannel('tiktok', {
      __type: 'tiktok',
    })).not.toThrow();
  });

  it('throws when channel and __type disagree', () => {
    expect(() => assertSettingsMatchesChannel('instagram', {
      __type: 'tiktok',
    })).toThrow('VALIDATION_SETTINGS_CHANNEL_MISMATCH');
  });

  it('is a no-op when settings is undefined', () => {
    expect(() => assertSettingsMatchesChannel('tiktok', undefined)).not.toThrow();
  });
});

describe('type guards', () => {
  it('narrows TikTok settings only when __type matches', () => {
    expect(asTikTokSettings({ __type: 'tiktok', privacyLevel: 'SELF_ONLY' })).toBeTruthy();
    expect(asTikTokSettings({ __type: 'youtube' })).toBeUndefined();
    expect(asTikTokSettings(undefined)).toBeUndefined();
    expect(asTikTokSettings(null)).toBeUndefined();
  });

  it('narrows IG settings only when __type matches', () => {
    expect(asInstagramSettings({ __type: 'instagram', postType: 'story' })).toBeTruthy();
    expect(asInstagramSettings({ __type: 'tiktok' })).toBeUndefined();
  });

  it('narrows YouTube settings only when __type matches', () => {
    expect(asYouTubeSettings({ __type: 'youtube', title: 'x' })).toBeTruthy();
    expect(asYouTubeSettings({ __type: 'instagram' })).toBeUndefined();
  });
});

describe('createPublicPostSchema with settings', () => {
  it('accepts a post with matching channel and settings', () => {
    const parsed = createPublicPostSchema.parse({
      channel: 'youtube',
      caption: 'Episode 1',
      mediaAssetIds: ['ast_1'],
      settings: { __type: 'youtube', title: 'Episode 1' },
    });
    expect(parsed.settings?.__type).toBe('youtube');
  });

  it('still accepts posts without settings', () => {
    const parsed = createPublicPostSchema.parse({
      channel: 'facebook',
      caption: 'Hello',
      mediaAssetIds: [],
    });
    expect(parsed.settings).toBeUndefined();
  });
});

describe('createPublicPostsBatchSchema', () => {
  it('accepts a batch of 1–25 posts', () => {
    const parsed = createPublicPostsBatchSchema.parse({
      posts: [
        { channel: 'facebook', caption: 'one', mediaAssetIds: [] },
        { channel: 'facebook', caption: 'two', mediaAssetIds: [] },
      ],
    });
    expect(parsed.posts).toHaveLength(2);
  });

  it('rejects empty batches', () => {
    expect(() => createPublicPostsBatchSchema.parse({ posts: [] })).toThrow();
  });

  it('rejects batches over 25 posts', () => {
    const items = Array.from({ length: 26 }, () => ({
      channel: 'facebook' as const,
      caption: 'x',
      mediaAssetIds: [],
    }));
    expect(() => createPublicPostsBatchSchema.parse({ posts: items })).toThrow();
  });
});
