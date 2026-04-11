import { describe, expect, it } from 'vitest';
import {
  buildSlideQuality,
  buildVisualSignature,
  scoreDistinctiveness,
  scoreHookStrength,
  scoreReadability,
  scoreVisualClarity,
} from '../slideshows/quality';

describe('slideshow quality helpers', () => {
  it('prefers concise hooks over rambling headlines', () => {
    const shortScore = scoreHookStrength('Stop posting random TikToks');
    const longScore = scoreHookStrength('This is a very long and rambling slideshow hook that keeps going without a punch or payoff and feels diluted');
    expect(shortScore).toBeGreaterThan(longScore);
  });

  it('rewards readable copy balance', () => {
    const balanced = scoreReadability('3 fixes for low-converting content', 'One idea per slide. Make each slide visually obvious.');
    const overloaded = scoreReadability('This headline is long and crowded and already says too much for one slide before we even get into the body copy', 'This body keeps going and going and tries to explain every possible point that could have been broken into separate slides for much cleaner consumption on TikTok.');
    expect(balanced).toBeGreaterThan(overloaded);
  });

  it('penalizes repeated themes across slides', () => {
    const duplicateScore = scoreDistinctiveness(
      {
        headline: 'Stop using generic hooks',
        body: 'Make your first slide sharper.',
        imagePrompt: 'Founder at desk with phone and notebook',
        visualIntent: {
          composition: 'Subject centered',
          subjectFocus: 'Founder and phone',
          safeTextRegion: 'top',
          lighting: 'Morning light',
          colorMood: 'Warm neutrals',
          motionStyle: 'Still',
        },
      },
      [{
        headline: 'Stop using generic hooks',
        body: 'Make your first slide sharper.',
        imagePrompt: 'Founder at desk with phone and notebook',
        visualIntent: {
          composition: 'Subject centered',
          subjectFocus: 'Founder and phone',
          safeTextRegion: 'top',
          lighting: 'Morning light',
          colorMood: 'Warm neutrals',
          motionStyle: 'Still',
        },
      }],
    );

    const uniqueScore = scoreDistinctiveness(
      {
        headline: 'Build narrative momentum by slide 3',
        body: 'Use a progression, not a list dump.',
        imagePrompt: 'Overhead storyboard cards on dark textured table',
        visualIntent: {
          composition: 'Overhead grid',
          subjectFocus: 'Storyboard cards',
          safeTextRegion: 'bottom',
          lighting: 'Studio overhead',
          colorMood: 'Charcoal and orange',
          motionStyle: 'Still',
        },
      },
      [{
        headline: 'Stop using generic hooks',
        body: 'Make your first slide sharper.',
        imagePrompt: 'Founder at desk with phone and notebook',
        visualIntent: {
          composition: 'Subject centered',
          subjectFocus: 'Founder and phone',
          safeTextRegion: 'top',
          lighting: 'Morning light',
          colorMood: 'Warm neutrals',
          motionStyle: 'Still',
        },
      }],
    );

    expect(uniqueScore).toBeGreaterThan(duplicateScore);
  });

  it('scores visual clarity from slideshow-safe intent', () => {
    const strong = scoreVisualClarity({
      composition: 'Clean lower-third subject with empty upper half',
      subjectFocus: 'Single phone screen',
      safeTextRegion: 'top',
      lighting: 'Hard side light',
      colorMood: 'Black, white, neon red',
      motionStyle: 'Still',
    }, 'A single smartphone on black acrylic with empty upper half for bold text overlay.');

    const weak = scoreVisualClarity(undefined, 'phone');
    expect(strong).toBeGreaterThan(weak);
  });

  it('builds quality notes for weak slides', () => {
    const quality = buildSlideQuality({
      kind: 'hook',
      headline: 'Generic content tips',
      body: 'This body is also extremely long and overloaded with too many details for a single slide to carry cleanly in a TikTok slideshow experience.',
      imagePrompt: 'phone',
      visualIntent: {
        composition: '',
        subjectFocus: 'Phone',
        safeTextRegion: 'middle',
        lighting: '',
        colorMood: '',
        motionStyle: 'Still',
      },
    }, []);

    expect(quality.notes.length).toBeGreaterThan(0);
  });

  it('creates stable visual signatures', () => {
    const signature = buildVisualSignature({
      headline: 'Three story arcs that keep viewers swiping',
      body: 'Use progression, stakes, payoff.',
      imagePrompt: 'Storyboard cards arranged on a textured desk',
      visualIntent: {
        composition: 'Overhead arrangement',
        subjectFocus: 'Cards and pencil',
        safeTextRegion: 'top',
        lighting: 'Soft daylight',
        colorMood: 'Warm neutrals',
        motionStyle: 'Still',
      },
    });

    expect(signature).toContain('storyboard');
    expect(signature).toContain('overhead');
  });
});
