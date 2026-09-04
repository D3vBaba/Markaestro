import { z } from 'zod';
import { generateStructured } from '@/lib/intelligence/ai-gateway';
import { sanitizeGeneratedCopy } from '@/lib/intelligence/drafts';
import type { DraftBrandContext } from '@/lib/intelligence/drafts';
import type { SocialChannel } from '@/lib/schemas';

export const VARIANT_ANGLES = ['new_hook', 'shorter', 'question', 'different_cta'] as const;
export type VariantAngle = (typeof VARIANT_ANGLES)[number];

export const variantOutputSchema = z.object({
  variants: z.array(z.object({
    angle: z.enum(VARIANT_ANGLES),
    caption: z.string().min(1).max(3000),
  })).min(1).max(6),
});

export type GeneratedVariant = { angle: VariantAngle; caption: string };

export const CHANNEL_CAPTION_LIMITS: Record<SocialChannel, number> = {
  instagram: 2200,
  facebook: 2200,
  tiktok: 300,
  threads: 500,
  pinterest: 500,
  linkedin: 1500,
  x: 280,
};

export function normalizeCaption(text: string): string {
  return text.toLowerCase().replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

export function variantSystemPrompt(channels: SocialChannel[]): string {
  const limit = Math.min(...channels.map((channel) => CHANNEL_CAPTION_LIMITS[channel] ?? 2200));
  return [
    'You rewrite one proven social media caption into alternative versions for the same brand, so it can be reposted without repeating itself.',
    `Write exactly four variants, one per angle: new_hook (same message, a different first line), shorter (the essentials in half the length), question (open with a question the audience would answer), different_cta (end with a different, concrete call to action).`,
    `Every variant must stay under ${limit} characters, keep the same facts and offer, and keep the language of the source caption.`,
    'Keep hashtags only if the source had them, and never add new claims, prices, dates, or links.',
    'Do not use em dashes or en dashes; use commas, periods, or parentheses. Never mention that the text was generated.',
  ].join(' ');
}

/**
 * Drop variants that are the source in disguise, duplicates of each other, or
 * over the tightest channel limit. Pure so it can be tested without a model.
 */
export function postProcessVariants(
  generated: GeneratedVariant[],
  source: string,
  channels: SocialChannel[],
): GeneratedVariant[] {
  const limit = Math.min(...channels.map((channel) => CHANNEL_CAPTION_LIMITS[channel] ?? 2200));
  const seen = new Set<string>([normalizeCaption(source)]);
  const out: GeneratedVariant[] = [];
  for (const variant of generated) {
    const caption = sanitizeGeneratedCopy(variant.caption);
    const key = normalizeCaption(caption);
    if (!key || seen.has(key) || caption.length > limit) continue;
    seen.add(key);
    out.push({ angle: variant.angle, caption });
  }
  return out;
}

export async function generateEvergreenVariants(input: {
  source: string;
  channels: SocialChannel[];
  brand: DraftBrandContext;
}): Promise<{ variants: GeneratedVariant[]; model: string }> {
  const generated = await generateStructured({
    schema: variantOutputSchema,
    system: variantSystemPrompt(input.channels),
    untrustedContent: JSON.stringify({
      brand: input.brand,
      channels: input.channels,
      sourceCaption: input.source,
    }),
    modelClass: 'fast',
  });
  return {
    variants: postProcessVariants(generated.value.variants, input.source, input.channels),
    model: generated.model,
  };
}
