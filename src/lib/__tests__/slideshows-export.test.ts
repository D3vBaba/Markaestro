import { describe, expect, it } from 'vitest';
import { assertSlideshowExportable, buildExportedSlideshowPost } from '../slideshows/export';

describe('slideshow export helpers', () => {
  const readySlideshow = {
    id: 'ss_123',
    productId: 'prod_123',
    caption: 'Three mistakes killing your TikTok slideshows',
    title: 'TikTok slideshow mistakes',
    coverSlideIndex: 0,
    channel: 'tiktok' as const,
    status: 'ready' as const,
  };

  const slides = [
    {
      index: 2,
      kind: 'cta' as const,
      headline: 'Save this and fix slide 1 first',
      body: '',
      cta: 'Save this',
      imagePrompt: 'CTA slide',
      imageUrl: 'https://example.com/3.jpg',
      imageStatus: 'generated' as const,
      visualIntent: {
        composition: 'Bold centered object low in frame',
        subjectFocus: 'Phone and arrow',
        safeTextRegion: 'top' as const,
        lighting: 'High contrast studio light',
        colorMood: 'Black and red',
        motionStyle: 'Still',
      },
    },
    {
      index: 0,
      kind: 'hook' as const,
      headline: 'Your first slide is too weak',
      body: '',
      cta: '',
      imagePrompt: 'Hook slide',
      imageUrl: 'https://example.com/1.jpg',
      imageStatus: 'generated' as const,
      visualIntent: {
        composition: 'Clean upper third',
        subjectFocus: 'Phone and hand',
        safeTextRegion: 'top' as const,
        lighting: 'Morning side light',
        colorMood: 'Warm neutrals',
        motionStyle: 'Still',
      },
    },
    {
      index: 1,
      kind: 'body' as const,
      headline: 'Build a story, not a list',
      body: 'Slide 2 should escalate the tension.',
      cta: '',
      imagePrompt: 'Body slide',
      imageUrl: 'https://example.com/2.jpg',
      imageStatus: 'generated' as const,
      visualIntent: {
        composition: 'Overhead grid',
        subjectFocus: 'Storyboard cards',
        safeTextRegion: 'bottom' as const,
        lighting: 'Soft daylight',
        colorMood: 'Warm tan',
        motionStyle: 'Still',
      },
    },
  ];

  it('builds an ordered exported post payload', () => {
    const post = buildExportedSlideshowPost(readySlideshow, slides);
    expect(post.channel).toBe('tiktok');
    expect(post.mediaUrls).toEqual([
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
    ]);
    expect(post.sourceType).toBe('slideshow');
    expect(post.slideshowId).toBe('ss_123');
    expect(post.slideshowSlideCount).toBe(3);
  });

  it('preserves coverSlideIndex in the exported post payload', () => {
    const post = buildExportedSlideshowPost({ ...readySlideshow, coverSlideIndex: 2 }, slides);
    expect(post.slideshowCoverIndex).toBe(2);
  });

  it('rejects export when any slide has an empty imageUrl', () => {
    expect(() => assertSlideshowExportable(readySlideshow, [
      { ...slides[0], imageUrl: '' },
      slides[1],
      slides[2],
    ])).toThrow('VALIDATION_SLIDESHOW_SLIDE_MISSING_IMAGE:2');
  });

  it('rejects export when a slide has imageStatus failed even if imageUrl is populated', () => {
    // A failed regeneration leaves the old imageUrl but sets imageStatus:'failed'.
    // The export must reject this to avoid publishing a stale image.
    expect(() => assertSlideshowExportable(readySlideshow, [
      { ...slides[0], imageStatus: 'failed' as const },
      slides[1],
      slides[2],
    ])).toThrow('VALIDATION_SLIDESHOW_SLIDE_MISSING_IMAGE:2');
  });

  it('rejects export when a slide has imageStatus pending', () => {
    expect(() => assertSlideshowExportable(readySlideshow, [
      slides[0],
      { ...slides[1], imageStatus: 'pending' as const, imageUrl: '' },
      slides[2],
    ])).toThrow('VALIDATION_SLIDESHOW_SLIDE_MISSING_IMAGE:0');
  });

  it('rejects export when slideshow is not ready', () => {
    expect(() => assertSlideshowExportable({ ...readySlideshow, status: 'draft' }, slides))
      .toThrow('VALIDATION_SLIDESHOW_NOT_READY_FOR_EXPORT');
  });

  it('accepts export when status is exported (re-export path)', () => {
    // Allow re-export so the UI can regenerate the post without resetting status.
    expect(() => assertSlideshowExportable({ ...readySlideshow, status: 'exported' }, slides))
      .not.toThrow();
  });

  it('rejects export when caption exceeds 4000 characters', () => {
    const longCaption = 'x'.repeat(4001);
    expect(() => assertSlideshowExportable({ ...readySlideshow, caption: longCaption }, slides))
      .toThrow('VALIDATION_SLIDESHOW_CAPTION_TOO_LONG:4001:4000');
  });

  it('accepts export when caption is exactly 4000 characters', () => {
    const maxCaption = 'x'.repeat(4000);
    expect(() => assertSlideshowExportable({ ...readySlideshow, caption: maxCaption }, slides))
      .not.toThrow();
  });

  it('rejects non-TikTok channels', () => {
    expect(() => assertSlideshowExportable(
      { ...readySlideshow, channel: 'instagram' as unknown as 'tiktok' },
      slides,
    )).toThrow('VALIDATION_SLIDESHOW_EXPORT_CHANNEL_UNSUPPORTED');
  });

  it('rejects fewer than 3 slides', () => {
    expect(() => assertSlideshowExportable(readySlideshow, slides.slice(0, 2)))
      .toThrow('VALIDATION_SLIDESHOW_EXPORT_INVALID_SLIDE_COUNT');
  });

  it('rejects more than 10 slides', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({
      ...slides[0],
      index: i,
    }));
    expect(() => assertSlideshowExportable(readySlideshow, tooMany))
      .toThrow('VALIDATION_SLIDESHOW_EXPORT_INVALID_SLIDE_COUNT');
  });
});
