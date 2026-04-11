import { describe, expect, it } from 'vitest';
import { parseRawSlideshowOutput } from '../slideshows/generator';

// ── Fixture helpers ───────────────────────────────────────────────────

function makeVisualIntent(overrides: Partial<{
  composition: string;
  subjectFocus: string;
  safeTextRegion: 'top' | 'middle' | 'bottom';
  lighting: string;
  colorMood: string;
  motionStyle: string;
}> = {}) {
  return {
    composition: 'Lower-third subject, empty upper third for overlay',
    subjectFocus: 'Founder hands around a coffee mug on a minimal desk',
    safeTextRegion: 'top' as const,
    lighting: 'Warm morning window light, soft shadows',
    colorMood: 'Warm amber and cream neutrals',
    motionStyle: 'Still',
    ...overrides,
  };
}

function makeSlide(overrides: Partial<{
  index: number;
  kind: 'hook' | 'body' | 'cta';
  headline: string;
  body: string;
  cta: string;
  imagePrompt: string;
  visualIntent: ReturnType<typeof makeVisualIntent>;
}> = {}) {
  return {
    index: 0,
    kind: 'hook' as const,
    headline: 'Stop posting random TikToks',
    body: '',
    cta: '',
    imagePrompt: 'A clean startup desk at dawn, phone on stand, notebook open. The upper third of the frame is entirely clear — warm cream-colored wall with no objects. Warm amber side light casts long shadows on the desk.',
    visualIntent: makeVisualIntent(),
    ...overrides,
  };
}

function makeValidOutput(slideCount = 6) {
  const slides = Array.from({ length: slideCount }, (_, i) => {
    if (i === 0) return makeSlide({ index: 0, kind: 'hook' });
    if (i === slideCount - 1) return makeSlide({ index: i, kind: 'cta', headline: 'Save this before your next post', cta: 'Save this' });
    return makeSlide({ index: i, kind: 'body', headline: `Insight number ${i + 1}`, body: 'Supporting detail for this slide.' });
  });
  return JSON.stringify({ title: 'TikTok mistakes founders make', caption: 'Stop doing this on TikTok.', slides });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('parseRawSlideshowOutput', () => {
  it('parses valid 6-slide output and returns hydrated slides', () => {
    const result = parseRawSlideshowOutput(makeValidOutput(6));
    expect(result).not.toBeNull();
    expect(result!.title).toBe('TikTok mistakes founders make');
    expect(result!.caption).toBe('Stop doing this on TikTok.');
    expect(result!.slides).toHaveLength(6);
  });

  it('adds imageUrl, imageStatus, and quality to every slide', () => {
    const result = parseRawSlideshowOutput(makeValidOutput(6));
    for (const slide of result!.slides) {
      expect(slide.imageUrl).toBe('');
      expect(slide.imageStatus).toBe('pending');
      expect(slide.quality).toBeDefined();
      expect(typeof slide.quality!.hookStrength).toBe('number');
      expect(typeof slide.quality!.readability).toBe('number');
      expect(typeof slide.quality!.distinctiveness).toBe('number');
      expect(typeof slide.quality!.visualClarity).toBe('number');
    }
  });

  it('preserves slide order and kind assignments', () => {
    const result = parseRawSlideshowOutput(makeValidOutput(6));
    expect(result!.slides[0].kind).toBe('hook');
    expect(result!.slides[5].kind).toBe('cta');
    for (let i = 1; i <= 4; i++) {
      expect(result!.slides[i].kind).toBe('body');
    }
  });

  it('accepts a 3-slide minimum', () => {
    const result = parseRawSlideshowOutput(makeValidOutput(3));
    expect(result).not.toBeNull();
    expect(result!.slides).toHaveLength(3);
  });

  it('accepts a 10-slide maximum', () => {
    const result = parseRawSlideshowOutput(makeValidOutput(10));
    expect(result).not.toBeNull();
    expect(result!.slides).toHaveLength(10);
  });

  it('returns null for empty string', () => {
    expect(parseRawSlideshowOutput('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseRawSlideshowOutput('not json at all')).toBeNull();
  });

  it('returns null when slides array is missing', () => {
    const bad = JSON.stringify({ title: 'ok', caption: 'ok' });
    expect(parseRawSlideshowOutput(bad)).toBeNull();
  });

  it('returns null when slides has fewer than 3 entries', () => {
    const bad = JSON.stringify({ title: 'ok', caption: 'ok', slides: [makeSlide(), makeSlide({ index: 1 })] });
    expect(parseRawSlideshowOutput(bad)).toBeNull();
  });

  it('returns null when a slide is missing imagePrompt', () => {
    const slides = [
      makeSlide({ index: 0, kind: 'hook' }),
      { index: 1, kind: 'body', headline: 'Missing prompt', body: '', cta: '', visualIntent: makeVisualIntent() },
      makeSlide({ index: 2, kind: 'cta' }),
    ];
    const bad = JSON.stringify({ title: 'ok', caption: 'ok', slides });
    expect(parseRawSlideshowOutput(bad)).toBeNull();
  });

  it('returns null when safeTextRegion is an invalid value', () => {
    const slide = makeSlide({ visualIntent: makeVisualIntent({ safeTextRegion: 'left' as never }) });
    const bad = JSON.stringify({ title: 'ok', caption: 'ok', slides: [slide, makeSlide({ index: 1, kind: 'body' }), makeSlide({ index: 2, kind: 'cta' })] });
    expect(parseRawSlideshowOutput(bad)).toBeNull();
  });

  it('returns null when kind is an invalid value', () => {
    const slide = makeSlide({ kind: 'intro' as never });
    const bad = JSON.stringify({ title: 'ok', caption: 'ok', slides: [slide, makeSlide({ index: 1, kind: 'body' }), makeSlide({ index: 2, kind: 'cta' })] });
    expect(parseRawSlideshowOutput(bad)).toBeNull();
  });

  it('strips markdown fences from model output', () => {
    const withFences = '```json\n' + makeValidOutput(4) + '\n```';
    const result = parseRawSlideshowOutput(withFences);
    expect(result).not.toBeNull();
    expect(result!.slides).toHaveLength(4);
  });

  it('quality scores are all between 0 and 1', () => {
    const result = parseRawSlideshowOutput(makeValidOutput(6));
    for (const slide of result!.slides) {
      const q = slide.quality!;
      expect(q.hookStrength).toBeGreaterThanOrEqual(0);
      expect(q.hookStrength).toBeLessThanOrEqual(1);
      expect(q.readability).toBeGreaterThanOrEqual(0);
      expect(q.readability).toBeLessThanOrEqual(1);
      expect(q.distinctiveness).toBeGreaterThanOrEqual(0);
      expect(q.distinctiveness).toBeLessThanOrEqual(1);
      expect(q.visualClarity).toBeGreaterThanOrEqual(0);
      expect(q.visualClarity).toBeLessThanOrEqual(1);
    }
  });

  it('first body slide has lower distinctiveness than its hook when they share subject matter', () => {
    const hookSlide = makeSlide({
      index: 0,
      kind: 'hook',
      headline: 'Stop posting random TikToks',
      imagePrompt: 'Founder at desk with phone and notebook',
      visualIntent: makeVisualIntent({ subjectFocus: 'Founder and phone', composition: 'Subject centered' }),
    });
    // Nearly identical body slide — should score lower distinctiveness
    const bodySlide = makeSlide({
      index: 1,
      kind: 'body',
      headline: 'Stop posting random TikToks',
      imagePrompt: 'Founder at desk with phone and notebook',
      visualIntent: makeVisualIntent({ subjectFocus: 'Founder and phone', composition: 'Subject centered' }),
    });
    const uniqueBodySlide = makeSlide({
      index: 1,
      kind: 'body',
      headline: 'Build narrative momentum across every slide',
      imagePrompt: 'Overhead storyboard cards on a dark textured table with charcoal and orange palette',
      visualIntent: makeVisualIntent({ subjectFocus: 'Storyboard cards', composition: 'Overhead grid', safeTextRegion: 'bottom' }),
    });
    const ctaSlide = makeSlide({ index: 2, kind: 'cta', headline: 'Save this now' });

    const duplicateResult = parseRawSlideshowOutput(
      JSON.stringify({ title: 'test', caption: 'test', slides: [hookSlide, bodySlide, ctaSlide] }),
    );
    const uniqueResult = parseRawSlideshowOutput(
      JSON.stringify({ title: 'test', caption: 'test', slides: [hookSlide, uniqueBodySlide, ctaSlide] }),
    );

    expect(uniqueResult!.slides[1].quality!.distinctiveness).toBeGreaterThan(
      duplicateResult!.slides[1].quality!.distinctiveness,
    );
  });
});
