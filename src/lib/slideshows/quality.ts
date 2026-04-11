/**
 * Slide quality scoring.
 *
 * buildVisualSignature — fingerprints a slide's content as a short token string.
 *   Used by the image generator to enforce visual diversity across the sequence:
 *   each slide receives the signatures of all preceding slides as context so the
 *   model avoids repeating compositions, subjects, and colour moods.
 *
 * buildSlideQuality — computes four 0–1 scores:
 *   hookStrength    — pattern interrupts, question words, strong verbs in headline
 *   readability     — word count, syllable estimate, punctuation density
 *   distinctiveness — token overlap between this slide and all others in the set
 *   visualClarity   — specificity of the visual intent (composition + subject focus)
 */
import type { SlideQuality, SlideVisualIntent, SlideshowSlide } from '@/lib/schemas';
import type { SlideQualityInput } from './types';

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function buildVisualSignature(input: { headline: string; body?: string; visualIntent?: SlideVisualIntent; imagePrompt?: string }) {
  const parts = [
    input.headline,
    input.body || '',
    input.visualIntent?.composition || '',
    input.visualIntent?.subjectFocus || '',
    input.visualIntent?.lighting || '',
    input.visualIntent?.colorMood || '',
    input.imagePrompt || '',
  ];
  return tokenize(parts.join(' ')).slice(0, 24).join('|');
}

export function scoreHookStrength(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  let score = 0.35;
  const wordCount = tokenize(trimmed).length;
  if (wordCount >= 4 && wordCount <= 12) score += 0.25;
  if (/\?/.test(trimmed)) score += 0.1;
  if (/\d/.test(trimmed)) score += 0.1;
  if (/^(stop|how|why|the|this|if|your)\b/i.test(trimmed)) score += 0.1;
  if (wordCount > 16) score -= 0.2;
  if (trimmed.length > 90) score -= 0.15;
  return clamp01(score);
}

export function scoreReadability(headline: string, body = '') {
  const headlineWords = tokenize(headline).length;
  const bodyWords = tokenize(body).length;
  let score = headline.trim() ? 0.45 : 0;
  if (headlineWords >= 2 && headlineWords <= 10) score += 0.25;
  if (bodyWords > 0 && bodyWords <= 24) score += 0.2;
  if (bodyWords > 40) score -= 0.2;
  if (headline.length > 120) score -= 0.15;
  return clamp01(score);
}

export function scoreDistinctiveness(currentSlide: Pick<SlideQualityInput, 'headline' | 'body' | 'visualIntent' | 'imagePrompt'>, previousSlides: Array<Pick<SlideQualityInput, 'headline' | 'body' | 'visualIntent' | 'imagePrompt'>>) {
  const currentSignature = new Set(tokenize(buildVisualSignature(currentSlide)));
  if (currentSignature.size === 0) return 0;
  let maxOverlap = 0;
  for (const previous of previousSlides) {
    const previousSignature = new Set(tokenize(buildVisualSignature(previous)));
    const overlap = [...currentSignature].filter((token) => previousSignature.has(token)).length;
    maxOverlap = Math.max(maxOverlap, overlap / currentSignature.size);
  }
  return clamp01(1 - maxOverlap);
}

export function scoreVisualClarity(visualIntent?: SlideVisualIntent, imagePrompt?: string) {
  let score = 0.2;
  if (visualIntent?.safeTextRegion) score += 0.25;
  if (visualIntent?.composition) score += 0.15;
  if (visualIntent?.subjectFocus) score += 0.15;
  if (visualIntent?.lighting) score += 0.1;
  if (visualIntent?.colorMood) score += 0.1;
  if ((imagePrompt || '').trim().length >= 40) score += 0.15;
  return clamp01(score);
}

export function buildSlideQuality(
  slide: Pick<SlideshowSlide, 'headline' | 'body' | 'kind' | 'visualIntent' | 'imagePrompt'>,
  previousSlides: Array<Pick<SlideshowSlide, 'headline' | 'body' | 'visualIntent' | 'imagePrompt'>> = [],
): SlideQuality {
  const hookStrength = slide.kind === 'hook' ? scoreHookStrength(slide.headline) : clamp01(scoreHookStrength(slide.headline) - 0.1);
  const readability = scoreReadability(slide.headline, slide.body);
  const distinctiveness = scoreDistinctiveness(slide, previousSlides);
  const visualClarity = scoreVisualClarity(slide.visualIntent, slide.imagePrompt);
  const notes: string[] = [];

  if (hookStrength < 0.55) notes.push('Headline hook is weak or too generic.');
  if (readability < 0.55) notes.push('Slide copy may be too long or poorly balanced for TikTok readability.');
  if (distinctiveness < 0.55) notes.push('Slide overlaps too much with earlier slides in the sequence.');
  if (visualClarity < 0.65) notes.push('Image prompt lacks enough composition guidance for overlay-safe slideshow output.');

  return {
    hookStrength,
    readability,
    distinctiveness,
    visualClarity,
    notes,
  };
}
