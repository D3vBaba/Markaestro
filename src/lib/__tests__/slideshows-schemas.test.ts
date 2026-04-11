import { describe, expect, it } from 'vitest';
import {
  createSlideshowSchema,
  slideshowSlideSchema,
  slideVisualIntentSchema,
} from '../schemas';
import { serializeSlideDoc, serializeSlideshowDoc } from '../slideshows/firestore';

describe('slideshow schemas', () => {
  it('accepts a valid tiktok slideshow payload', () => {
    const parsed = createSlideshowSchema.parse({
      productId: 'prod_123',
      prompt: 'Create a ReelFarm style slideshow about 5 mistakes founders make on TikTok',
      slideCount: 6,
      imageStyle: 'branded',
      imageProvider: 'gemini',
    });

    expect(parsed.channel).toBe('tiktok');
    expect(parsed.slideCount).toBe(6);
    expect(parsed.renderMode).toBe('carousel_images');
    expect(parsed.aspectRatio).toBe('9:16');
  });

  it('rejects non-tiktok slideshow channels', () => {
    expect(() => createSlideshowSchema.parse({
      productId: 'prod_123',
      prompt: 'Bad channel',
      channel: 'instagram',
    })).toThrow();
  });

  it('rejects slide counts outside 3-10', () => {
    expect(() => createSlideshowSchema.parse({
      productId: 'prod_123',
      prompt: 'Too short',
      slideCount: 2,
    })).toThrow();

    expect(() => createSlideshowSchema.parse({
      productId: 'prod_123',
      prompt: 'Too long',
      slideCount: 11,
    })).toThrow();
  });

  it('rejects invalid safe text regions', () => {
    expect(() => slideVisualIntentSchema.parse({
      composition: 'Centered product shot',
      subjectFocus: 'Founder at desk',
      safeTextRegion: 'left',
      lighting: 'Soft daylight',
      colorMood: 'High contrast warm neutrals',
      motionStyle: 'Still',
    })).toThrow();
  });

  it('accepts a valid slide payload', () => {
    const slide = slideshowSlideSchema.parse({
      index: 0,
      kind: 'hook',
      headline: 'Stop posting random TikToks',
      body: 'Your content needs a narrative arc.',
      imagePrompt: 'A high-contrast startup desk with clean empty top space for text overlay.',
      visualIntent: {
        composition: 'Negative space above subject',
        subjectFocus: 'Founder and laptop',
        safeTextRegion: 'top',
        lighting: 'Directional morning light',
        colorMood: 'Warm neutral palette',
        motionStyle: 'Still frame',
      },
    });

    expect(slide.imageStatus).toBe('pending');
    expect(slide.kind).toBe('hook');
  });

  it('serializes slideshow and slide docs with safe defaults', () => {
    const slideshow = serializeSlideshowDoc('ss_123', {
      workspaceId: 'ws_123',
      productId: 'prod_123',
      prompt: 'Create a founder slideshow',
      createdBy: 'user_123',
    });
    const slide = serializeSlideDoc('slide_1', {
      index: 0,
      kind: 'hook',
      headline: 'Your slideshow needs stronger hooks',
      imagePrompt: 'Minimal phone-on-desk shot with empty upper third.',
      visualIntent: {
        composition: 'Top safe area',
        subjectFocus: 'Phone and hand',
        safeTextRegion: 'top',
        lighting: 'Studio rim light',
        colorMood: 'Cool neutrals',
        motionStyle: 'Still',
      },
    });

    expect(slideshow.status).toBe('draft');
    expect(slideshow.renderStatus).toBe('not_started');
    expect(slideshow.slideCount).toBe(6);
    expect(slide.imageStatus).toBe('pending');
    expect(slide.body).toBe('');
  });
});
