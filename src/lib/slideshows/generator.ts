/**
 * Slideshow content generator.
 *
 * generateSlideshowContent() calls GPT-4o-mini with a structured JSON prompt to
 * produce N slide briefs. Each brief includes copy (headline, body, cta), an
 * imagePrompt, and a visualIntent object that drives the image generation step.
 *
 * Retry logic:
 *   - First attempt at temperature 0.8 for creative variety.
 *   - On parse failure: retries once at temperature 0.2 with the bad output
 *     appended so the model can self-correct.
 *   - If the retry also fails, throws 'SLIDESHOW_GENERATION_FAILED: <reason>'.
 *
 * parseRawSlideshowOutput() is exported for unit testing without mocking OpenAI.
 * It strips markdown fences, parses JSON, validates against an internal Zod
 * schema, and hydrates each slide with imageUrl:'', imageStatus:'pending', and
 * quality scores from buildSlideQuality().
 */
import OpenAI from 'openai';
import { z } from 'zod';
import type { BrandVoice, SlideshowSlide } from '@/lib/schemas';
import { buildBrandVoiceBlock } from '@/lib/ai/content-generator';
import { buildSlideQuality } from './quality';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

// ── Public types ──────────────────────────────────────────────────────

export type GenerateSlideshowInput = {
  productName: string;
  productDescription: string;
  productCategories: string[];
  productUrl?: string;
  prompt: string;
  visualStyle?: string;
  brandVoice?: BrandVoice;
  researchContext?: string;
};

export type GeneratedSlideshowContent = {
  title: string;
  caption: string;
  slides: SlideshowSlide[];
};

// ── Internal parse schema ─────────────────────────────────────────────
//
// Looser than SlideshowSlide — no imageUrl/imageStatus/quality since
// the LLM doesn't produce those; we add them after parsing.

const llmVisualIntentSchema = z.object({
  composition: z.string().trim().min(1).max(200),
  subjectFocus: z.string().trim().min(1).max(200),
  safeTextRegion: z.enum(['top', 'middle', 'bottom']),
  lighting: z.string().trim().min(1).max(200),
  colorMood: z.string().trim().min(1).max(200),
  motionStyle: z.string().trim().min(1).max(200),
});

const llmSlideSchema = z.object({
  index: z.number().int().min(0).max(9),
  kind: z.enum(['hook', 'body', 'cta']),
  headline: z.string().trim().min(1).max(200),
  body: z.string().trim().max(500).default(''),
  cta: z.string().trim().max(200).default(''),
  imagePrompt: z.string().trim().min(10).max(4000),
  visualIntent: llmVisualIntentSchema,
});

const llmOutputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  caption: z.string().trim().max(4000).default(''),
  slides: z.array(llmSlideSchema).min(3).max(10),
});

// ── System prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a TikTok slideshow content strategist who creates high-performing carousel slideshows in the ReelFarm style.

WHAT A TIKTOK SLIDESHOW IS:
A TikTok slideshow is a sequence of 6–10 full-screen 9:16 portrait images the viewer swipes through left-to-right. Each slide is a background image with bold text overlaid. The text MUST be short (headline = 3–10 words) because it sits on top of the photo. The images must be designed with a clear empty zone where text can overlay without conflict.

YOUR JOB:
Produce a structured slideshow with a strong narrative arc that earns every swipe:
1. Slide 0 (kind: "hook") — Stop the scroll. Create immediate tension, curiosity, or desire. The hook must make the viewer NEED to swipe to see more. Short, punchy, 3–8 words. Never explain — tease.
2. Middle slides (kind: "body") — One single insight per slide. Each deepens the story or answers the hook's implied question. Never put more than one idea per slide. Build momentum.
3. Final slide (kind: "cta") — A clear, specific call to action. What should they do next? "Save this before you post again" beats "Follow for more".

HEADLINE RULES:
- Hook: 3–8 words. Creates immediate desire to swipe. Question, bold claim, or pattern interrupt.
- Body: 4–12 words. One complete thought. Nothing that requires the next slide to make sense.
- CTA: 4–12 words. Specific action. Imperative verb. Concrete payoff.
- NEVER use: "amazing", "incredible", "game-changer", "revolutionary", "mindblowing", "seamlessly"
- NEVER write a headline that requires the image to complete its meaning

IMAGE PROMPT RULES:
- Describe a real, specific photographic scene — not abstract art, not "lifestyle vibes"
- The image MUST have a clearly empty area matching the safeTextRegion field for text overlay
- No readable text, no signs, no labels in the image — image models hallucinate fake words
- TikTok slideshows perform best with: authentic lo-fi phone aesthetic, real objects, warm natural or mixed indoor light
- Vary the scenes across slides — different angles, subjects, and lighting per slide
- 3–5 sentences. Include the safe zone direction explicitly.

VISUAL INTENT RULES:
- safeTextRegion: where the image has clear empty space for text overlay. Alternate across slides.
- composition: one specific compositional instruction (e.g. "Lower-third subject, empty upper third for overlay")
- subjectFocus: the main visual subject (e.g. "Founder hands around a coffee mug")
- lighting: the light source and quality (e.g. "Warm window light, long morning shadows")
- colorMood: the color palette (e.g. "Warm amber and cream neutrals")
- motionStyle: "Still" for static frames, or "Slight motion blur" for kinetic energy

CAPTION:
One TikTok caption for the whole slideshow. Under 100 characters. Hook-first. No hashtags.

Return ONLY a valid JSON object — no markdown fences, no explanation text.`;

// ── User prompt builder ───────────────────────────────────────────────

function buildUserPrompt(input: GenerateSlideshowInput, slideCount: number): string {
  const parts: string[] = [];

  parts.push(`Generate a TikTok slideshow with exactly ${slideCount} slides.`);

  parts.push(`\nPRODUCT:
Name: ${input.productName}
Description: ${input.productDescription}
Categories: ${input.productCategories.join(', ')}${input.productUrl ? `\nURL: ${input.productUrl}` : ''}`);

  parts.push(`\nSLIDESHOW BRIEF:
${input.prompt}`);

  if (input.visualStyle && input.visualStyle !== 'reelfarm') {
    parts.push(`\nVISUAL STYLE: ${input.visualStyle}`);
  }

  if (input.researchContext) {
    parts.push(`\nMARKET CONTEXT:\n${input.researchContext}`);
  }

  const bodyCount = slideCount - 2;
  parts.push(`\nSLIDE STRUCTURE:
- Slide 0: kind "hook" — stops the scroll
- Slides 1–${bodyCount}: kind "body" — one insight each
- Slide ${slideCount - 1}: kind "cta" — specific call to action

SAFE TEXT REGION PATTERN: Alternate across slides. Start with "top" for the hook, then vary so no two adjacent slides use the same region. Use all three values across the sequence.

Return exactly this JSON structure:
{
  "title": "short internal working title",
  "caption": "TikTok caption under 100 chars",
  "slides": [
    {
      "index": 0,
      "kind": "hook",
      "headline": "3–8 word hook",
      "body": "",
      "cta": "",
      "imagePrompt": "Detailed 3–5 sentence photo scene. State which third is kept empty for text.",
      "visualIntent": {
        "composition": "specific compositional instruction",
        "subjectFocus": "what is in the frame",
        "safeTextRegion": "top",
        "lighting": "light quality and source",
        "colorMood": "color palette",
        "motionStyle": "Still"
      }
    }
  ]
}

Return exactly ${slideCount} slides. Every slide must have all fields. No missing fields.`);

  return parts.join('\n');
}

// ── Output parsing ────────────────────────────────────────────────────

export function parseRawSlideshowOutput(text: string): GeneratedSlideshowContent | null {
  let json: unknown;
  try {
    const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    json = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const result = llmOutputSchema.safeParse(json);
  if (!result.success) return null;

  const { title, caption, slides } = result.data;

  const hydratedSlides: SlideshowSlide[] = slides.map((slide, i) => {
    const previousSlides = slides.slice(0, i).map((p) => ({
      headline: p.headline,
      body: p.body,
      visualIntent: p.visualIntent,
      imagePrompt: p.imagePrompt,
    }));

    const quality = buildSlideQuality(
      {
        headline: slide.headline,
        body: slide.body,
        kind: slide.kind,
        visualIntent: slide.visualIntent,
        imagePrompt: slide.imagePrompt,
      },
      previousSlides,
    );

    return {
      index: slide.index,
      kind: slide.kind,
      headline: slide.headline,
      body: slide.body,
      cta: slide.cta,
      imagePrompt: slide.imagePrompt,
      imageUrl: '',
      imageStatus: 'pending' as const,
      visualIntent: slide.visualIntent,
      quality,
    };
  });

  return { title, caption, slides: hydratedSlides };
}

// ── Repair prompt ─────────────────────────────────────────────────────

function buildRepairPrompt(rawOutput: string): string {
  return `The JSON you returned failed schema validation. Fix and return only a valid JSON object.

Common issues to check:
- Every slide must have: index, kind, headline, body, cta, imagePrompt, visualIntent
- visualIntent must have all 6 fields: composition, subjectFocus, safeTextRegion, lighting, colorMood, motionStyle
- safeTextRegion must be exactly "top", "middle", or "bottom"
- kind must be exactly "hook", "body", or "cta"
- slides array must have at least 3 entries
- No markdown code fences around the JSON

Your previous output (first 2000 chars):
${rawOutput.slice(0, 2000)}

Return the corrected JSON object only.`;
}

// ── Main generator ────────────────────────────────────────────────────

export async function generateSlideshowContent(
  input: GenerateSlideshowInput,
  slideCount: number,
): Promise<GeneratedSlideshowContent> {
  const client = getClient();

  let systemPrompt = SYSTEM_PROMPT;
  if (input.brandVoice) {
    systemPrompt += buildBrandVoiceBlock(input.brandVoice);
  }

  const userPrompt = buildUserPrompt(input, slideCount);

  const firstResponse = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.8,
    max_tokens: 4000,
  });

  const firstRaw = firstResponse.choices[0]?.message?.content || '';
  const firstResult = parseRawSlideshowOutput(firstRaw);
  if (firstResult) return firstResult;

  // Parse failed — one repair attempt at lower temperature
  const repairResponse = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: firstRaw },
      { role: 'user', content: buildRepairPrompt(firstRaw) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 4000,
  });

  const repairRaw = repairResponse.choices[0]?.message?.content || '';
  const repairResult = parseRawSlideshowOutput(repairRaw);
  if (repairResult) return repairResult;

  throw new Error('SLIDESHOW_GENERATION_FAILED: Unable to produce a valid slideshow structure after repair attempt');
}
