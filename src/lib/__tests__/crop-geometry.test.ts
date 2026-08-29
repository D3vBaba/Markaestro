import { describe, expect, it } from 'vitest';
import {
  allSameRatio,
  presetsForChannels,
  recommendedPreset,
  sameRatio,
} from '@/lib/media/aspect-ratios';
import {
  clampCrop,
  coverExtent,
  identityCrop,
  sourceRect,
} from '@/lib/media/crop-geometry';
import { classifyPublishError } from '@/lib/social/publisher';

// The four images from the Pin that Pinterest rejected with
// "Images must have the same width/height ratios".
const REJECTED_BATCH = [
  { w: 941, h: 1672 },
  { w: 360, h: 540 },
  { w: 2400, h: 3000 },
  { w: 768, h: 1376 },
];

describe('aspect ratio rules', () => {
  it('treats the ratios Pinterest rejected as different shapes', () => {
    const ratios = REJECTED_BATCH.map(({ w, h }) => w / h);
    expect(allSameRatio(ratios)).toBe(false);
    // 0.5628 vs 0.5581 — close enough to look identical, still rejected.
    expect(sameRatio(941 / 1672, 768 / 1376)).toBe(false);
  });

  it('reports one shape once every image is cropped to the same preset', () => {
    const preset = recommendedPreset(['pinterest']);
    const cropped = REJECTED_BATCH.map(({ w, h }) => {
      const rect = sourceRect(w, h, identityCrop(), preset.ratio);
      return rect.width / rect.height;
    });
    expect(allSameRatio(cropped)).toBe(true);
    expect(cropped.every((ratio) => sameRatio(ratio, preset.ratio))).toBe(true);
  });

  it('opens on the shape each network is least forgiving about', () => {
    expect(recommendedPreset(['tiktok']).label).toBe('9:16');
    expect(recommendedPreset(['pinterest']).label).toBe('2:3');
    expect(recommendedPreset(['instagram']).label).toBe('4:5');
    expect(recommendedPreset(['facebook']).label).toBe('1:1');
    // TikTok wins over a looser channel sharing the post.
    expect(recommendedPreset(['facebook', 'tiktok']).label).toBe('9:16');
  });

  it('keeps every preset available while leading with the fitting ones', () => {
    const ordered = presetsForChannels(['pinterest']);
    expect(ordered).toHaveLength(5);
    expect(ordered[0].bestFor).toContain('pinterest');
  });
});

describe('crop geometry', () => {
  it('covers the frame exactly at zoom 1', () => {
    // Portrait source into a square frame: width fits, height overflows.
    const extent = coverExtent(2 / 3, 1, 1);
    expect(extent.width).toBeCloseTo(1, 10);
    expect(extent.height).toBeCloseTo(1.5, 10);

    // Landscape source into the same frame: the other way round.
    const wide = coverExtent(16 / 9, 1, 1);
    expect(wide.width).toBeCloseTo(16 / 9, 10);
    expect(wide.height).toBeCloseTo(1, 10);
  });

  it('pins an unzoomed crop on the axis with nothing to spare', () => {
    // A 2:3 source in a 2:3 frame has no slack in either direction.
    const clamped = clampCrop({ zoom: 1, offsetX: 0.4, offsetY: 0.4 }, 2 / 3, 2 / 3);
    expect(clamped.offsetX).toBeCloseTo(0, 10);
    expect(clamped.offsetY).toBeCloseTo(0, 10);
  });

  it('allows panning only as far as the image reaches', () => {
    // 3:2 source in a 1:1 frame: 1.5 frame-widths wide, so ±0.25 of slack.
    const clamped = clampCrop({ zoom: 1, offsetX: 5, offsetY: 5 }, 3 / 2, 1);
    expect(clamped.offsetX).toBeCloseTo(0.25, 10);
    expect(clamped.offsetY).toBeCloseTo(0, 10);
  });

  it('keeps the source rect inside the image at the pan limits', () => {
    const atLimit = clampCrop({ zoom: 1, offsetX: 999, offsetY: 999 }, 3 / 2, 1);
    const rect = sourceRect(1500, 1000, atLimit, 1);
    expect(rect.sx).toBeCloseTo(0, 6);
    expect(rect.sy).toBeCloseTo(0, 6);
    expect(rect.sx + rect.width).toBeLessThanOrEqual(1500 + 1e-6);
    expect(rect.sy + rect.height).toBeLessThanOrEqual(1000 + 1e-6);
  });

  it('centres the crop when nothing is panned', () => {
    // 1000x1000 into 2:3 leaves a centred 666.67x1000 window.
    const rect = sourceRect(1000, 1000, identityCrop(), 2 / 3);
    expect(rect.width / rect.height).toBeCloseTo(2 / 3, 10);
    expect(rect.sx).toBeCloseTo((1000 - rect.width) / 2, 6);
    expect(rect.sy).toBeCloseTo(0, 6);
  });

  it('shrinks the framed region as zoom rises', () => {
    const wide = sourceRect(1200, 1200, identityCrop(), 1);
    const zoomed = sourceRect(1200, 1200, { zoom: 2, offsetX: 0, offsetY: 0 }, 1);
    expect(zoomed.width).toBeCloseTo(wide.width / 2, 6);
    expect(zoomed.width / zoomed.height).toBeCloseTo(1, 10);
  });

  it('never returns a rect outside the image for unclamped state', () => {
    const rect = sourceRect(800, 600, { zoom: 1, offsetX: -50, offsetY: -50 }, 1);
    expect(rect.sx).toBeGreaterThanOrEqual(0);
    expect(rect.sy).toBeGreaterThanOrEqual(0);
    expect(rect.sx + rect.width).toBeLessThanOrEqual(800 + 1e-6);
    expect(rect.sy + rect.height).toBeLessThanOrEqual(600 + 1e-6);
  });
});

describe('publish error classification', () => {
  it('stops retrying a mixed-ratio rejection', () => {
    const classification = classifyPublishError(
      'Pinterest pin create failed (400): Images must have the same width/height ratios.',
    );
    expect(classification.code).toBe('MEDIA_ASPECT_RATIO_MISMATCH');
    expect(classification.category).toBe('permanent');
    expect(classification.retryable).toBe(false);
  });

  it('stops retrying the rewritten adapter message too', () => {
    const classification = classifyPublishError(
      'Pinterest needs every image in a Pin to have the same width/height ratio. Re-crop the images to one shape and try again.',
    );
    expect(classification.category).toBe('permanent');
  });

  it('stops retrying a post that carries more media than the channel allows', () => {
    const classification = classifyPublishError(
      'Instagram allows a maximum of 10 media items per carousel. This post has 12. Remove the extra items and publish again.',
    );
    expect(classification.code).toBe('MEDIA_COUNT_EXCEEDED');
    expect(classification.category).toBe('permanent');
    expect(classification.retryable).toBe(false);
  });

  it('stops retrying a story that carries carousel media', () => {
    const classification = classifyPublishError(
      'Instagram stories accept a single image or video, and this post has 3 media items.',
    );
    expect(classification.category).toBe('permanent');
  });

  it('treats a Graph request-limit refusal as a Meta throttle, not a generic blip', () => {
    for (const message of [
      'Instagram carousel child error: (#4) Application request limit reached',
      'Instagram carousel child error: (#17) User request limit reached',
      'Facebook publish error: Calls to this api have exceeded the rate limit',
    ]) {
      const classification = classifyPublishError(message);
      expect(classification.code).toBe('META_REQUEST_LIMIT_REACHED');
      expect(classification.metaRateLimited).toBe(true);
      expect(classification.retryable).toBe(true);
    }
  });
});
