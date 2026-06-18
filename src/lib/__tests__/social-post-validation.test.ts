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
