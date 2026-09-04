import { describe, expect, it } from 'vitest';
import { normalizeCaption, postProcessVariants, variantSystemPrompt } from './variants';

describe('postProcessVariants', () => {
  it('drops copies of the source, duplicates, and captions over the tightest channel limit', () => {
    const source = 'Cold brew season starts Friday. #coffee';
    const out = postProcessVariants([
      { angle: 'new_hook', caption: 'Friday is cold brew day.' },
      { angle: 'shorter', caption: 'cold brew season starts friday' },
      { angle: 'question', caption: 'Friday is cold brew day.' },
      { angle: 'different_cta', caption: 'x'.repeat(300) },
    ], source, ['x', 'instagram']);
    expect(out).toEqual([{ angle: 'new_hook', caption: 'Friday is cold brew day.' }]);
  });
  it('strips dashes the model slipped in', () => {
    const out = postProcessVariants([{ angle: 'new_hook', caption: 'Ready — set – go' }], 'source', ['instagram']);
    expect(out[0].caption).toBe('Ready, set, go');
  });
  it('normalises hashtags and whitespace when comparing', () => {
    expect(normalizeCaption('Hello   World #tag')).toBe('hello world');
  });
  it('mentions the tightest limit in the prompt', () => {
    expect(variantSystemPrompt(['instagram', 'x'])).toContain('under 280 characters');
  });
});
