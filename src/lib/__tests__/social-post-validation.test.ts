import { describe, expect, it } from 'vitest';
import { normalizeTargetChannels, validateSocialPost } from '../social/post-validation';

describe('validateSocialPost', () => {
  it('requires media for media-only social channels', () => {
    const issues = validateSocialPost({
      content: 'Launch',
      channel: 'pinterest',
      targetChannels: ['instagram', 'pinterest'],
      mediaUrls: [],
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      'VALIDATION_INSTAGRAM_MEDIA_REQUIRED',
      'VALIDATION_PINTEREST_MEDIA_REQUIRED',
    ]);
  });

  it('does not fall back to channel when targetChannels is explicitly empty', () => {
    expect(normalizeTargetChannels({
      channel: 'facebook',
      targetChannels: [],
    })).toEqual([]);

    expect(validateSocialPost({
      content: 'Launch',
      channel: 'facebook',
      targetChannels: [],
    })).toContainEqual({
      code: 'VALIDATION_CHANNEL_REQUIRED',
      message: 'Select at least one publishing channel.',
    });
  });

  it('applies the strictest media cap across selected channels', () => {
    const issues = validateSocialPost({
      content: 'Carousel',
      channel: 'facebook',
      targetChannels: ['facebook', 'pinterest'],
      mediaUrls: Array.from({ length: 6 }, (_, idx) => `https://example.com/${idx}.jpg`),
    });

    expect(issues).toContainEqual({
      channel: 'pinterest',
      code: 'VALIDATION_PINTEREST_TOO_MANY_MEDIA_ITEMS',
      message: 'Pinterest supports up to 5 media items.',
    });
  });

  it('allows TikTok photo carousels up to 35 images', () => {
    const issues = validateSocialPost({
      content: 'Carousel',
      channel: 'tiktok',
      mediaUrls: Array.from({ length: 35 }, (_, idx) => `https://example.com/${idx}.jpg`),
    });

    expect(issues).toEqual([]);
  });

  it('rejects Pinterest videos mixed with other media', () => {
    const issues = validateSocialPost({
      content: 'Pin',
      channel: 'pinterest',
      mediaUrls: ['https://example.com/video.mp4', 'https://example.com/image.jpg'],
    });

    expect(issues).toContainEqual({
      channel: 'pinterest',
      code: 'VALIDATION_PINTEREST_VIDEO_MUST_BE_SINGLE_MEDIA',
      message: 'Pinterest video pins must use a single video without additional images.',
    });
  });
});

/**
 * The 4.6 unification: `validateSocialPost` (app) and the public API's
 * validators enforced overlapping but non-identical rules. These tests pin
 * the three divergences the audit named, now closed in the one shared engine.
 */
describe('the unified rule set (4.6)', () => {
  it('refuses a Facebook post with neither caption nor media', () => {
    // The API always enforced this; the app never did, so an empty Facebook
    // post could be scheduled from the composer and failed later with a raw
    // Graph API error.
    const issues = validateSocialPost({ content: '', channel: 'facebook', mediaUrls: [] });
    expect(issues).toContainEqual(expect.objectContaining({
      channel: 'facebook',
      code: 'VALIDATION_FACEBOOK_POST_REQUIRES_CONTENT_OR_MEDIA',
    }));
    expect(validateSocialPost({ content: 'hi', channel: 'facebook', mediaUrls: [] })).toEqual([]);
    expect(validateSocialPost({
      content: '', channel: 'facebook', mediaUrls: ['https://example.com/a.jpg'],
    })).toEqual([]);
  });

  it('trusts resolved media types over the URL heuristic', () => {
    // A video URL with no recognisable extension used to be treated as an
    // image, routing it down the wrong publish path.
    const extensionless = 'https://storage.example/uploads/abc123';
    // Heuristic path: looks like an image, so a Pinterest multi-media pin passes.
    expect(validateSocialPost({
      content: 'Pin', channel: 'pinterest',
      mediaUrls: [extensionless, 'https://example.com/b.jpg'],
    })).toEqual([]);
    // Typed path: it is actually a video, so the single-video rule fires.
    expect(validateSocialPost({
      content: 'Pin', channel: 'pinterest',
      mediaUrls: [extensionless, 'https://example.com/b.jpg'],
      mediaTypes: ['video', 'image'],
    })).toContainEqual(expect.objectContaining({
      code: 'VALIDATION_PINTEREST_VIDEO_MUST_BE_SINGLE_MEDIA',
    }));
  });

  it('emits the API-stable TikTok codes when types are resolved', () => {
    // Clients branch on the exact code, so the typed path keeps the codes the
    // public API has always returned.
    expect(validateSocialPost({
      content: 'x', channel: 'tiktok',
      mediaUrls: ['https://a/1', 'https://a/2'],
      mediaTypes: ['video', 'video'],
    })).toContainEqual(expect.objectContaining({ code: 'VALIDATION_TIKTOK_MAX_ONE_VIDEO' }));
    expect(validateSocialPost({
      content: 'x', channel: 'tiktok',
      mediaUrls: ['https://a/1', 'https://a/2'],
      mediaTypes: ['video', 'image'],
    })).toContainEqual(expect.objectContaining({ code: 'VALIDATION_TIKTOK_VIDEO_CANNOT_BE_COMBINED' }));
  });

  // The table is the specification: channel, caption, media shape, and the
  // exact issue codes expected. Adding a channel means adding rows, and a rule
  // change that alters any cell has to be argued with here.
  it.each([
    ['facebook', 'hi', [], [], []],
    ['facebook', '', [], [], ['VALIDATION_FACEBOOK_POST_REQUIRES_CONTENT_OR_MEDIA']],
    ['instagram', 'hi', [], [], ['VALIDATION_INSTAGRAM_MEDIA_REQUIRED']],
    ['instagram', 'hi', ['v'], ['video'], []],
    ['threads', 'hi', ['v'], ['video'], []],
    ['linkedin', '', ['i'], ['image'], ['VALIDATION_LINKEDIN_CONTENT_REQUIRED']],
    ['linkedin', 'hi', ['v', 'i'], ['video', 'image'], ['VALIDATION_LINKEDIN_VIDEO_MUST_BE_SINGLE_MEDIA']],
    ['pinterest', 'hi', ['v', 'i'], ['video', 'image'], ['VALIDATION_PINTEREST_VIDEO_MUST_BE_SINGLE_MEDIA']],
    ['tiktok', 'hi', ['v', 'v'], ['video', 'video'], ['VALIDATION_TIKTOK_MAX_ONE_VIDEO']],
    ['tiktok', 'hi', ['i'], ['image'], []],
  ] as const)(
    '%s with caption %j and media types %j yields %j',
    (channel, content, urls, types, expectedCodes) => {
      const issues = validateSocialPost({
        content,
        channel,
        mediaUrls: urls.map((_, i) => `https://example.com/media-${i}`),
        mediaTypes: [...types],
      });
      expect(issues.map((issue) => issue.code)).toEqual(expectedCodes);
    },
  );
});
