/**
 * Slideshow content generator.
 *
 * generateSlideshowContent() calls GPT-4o-mini with a structured JSON prompt to
 * produce N slide briefs. Each brief includes copy (headline, body, cta), an
 * imagePrompt, and a visualIntent object that drives the image generation step.
 *
 * Story formats (storyFormat field):
 *   hook_value_cta   — Hook → value stack → CTA (default, works for any product)
 *   problem_solution — Problem → agitation → solution reveal → proof → CTA
 *   transformation   — Before state → journey → after state → CTA
 *   feature_listicle — "N reasons / features" hook → one feature per slide → CTA
 *   ugc_testimonial  — First-person story arc ("I was struggling with X until…")
 *   product_lookbook — Hook → 4–5 use cases or scenarios → CTA
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
import type { BrandVoice, SlideshowSlide, StoryFormat, ProductKnowledge } from '@/lib/schemas';
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
  storyFormat?: StoryFormat;
  productKnowledge?: ProductKnowledge;
  characterModelDescription?: string;
};

export type GeneratedSlideshowContent = {
  title: string;
  caption: string;
  slides: SlideshowSlide[];
};

// ── Internal parse schema ─────────────────────────────────────────────

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

// ── Hook formula bank ─────────────────────────────────────────────────
//
// Research-backed hook formulas that stop the scroll. The LLM draws from
// these instead of generating generic hooks.

const HOOK_FORMULA_BANK = `PROVEN HOOK FORMULAS (use the best fit for the product and format):
- "If you're still [old behavior / pain], stop reading." (Pattern interrupt)
- "[Number] signs you need [product/solution]" (Curiosity + number)
- "Everything you know about [category] is wrong" (Belief reversal)
- "Day 1 vs Day [X] — same [product/routine]" (Before/after)
- "I switched from [competitor/old way] to [product]. Here's what happened." (UGC testimonial hook)
- "Nobody talks about [surprising feature/benefit]" (Hidden gem)
- "Stop wasting [time/money] on [old solution]" (Cost of inaction)
- "[Shocking stat] about [problem]" (Data-driven urgency)`;

// ── Story format definitions ──────────────────────────────────────────

type FormatDef = {
  description: string;
  structureInstructions: string;
  slideKindPattern: (slideCount: number) => ('hook' | 'body' | 'cta')[];
};

const STORY_FORMAT_DEFS: Record<StoryFormat, FormatDef> = {
  hook_value_cta: {
    description: 'Hook → value stack → CTA. The universal format. The hook creates desire, each body slide delivers one concrete value or insight, the CTA converts.',
    structureInstructions: `Slide 0: Hook — stops the scroll, creates immediate desire or curiosity. 3–8 words.
Middle slides: Body — one insight or benefit per slide. Build momentum with each swipe.
Final slide: CTA — specific, concrete action with a clear payoff. "Save this before you post again" beats "Follow for more".`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  problem_solution: {
    description: 'Problem → agitation → solution reveal → proof → CTA. Call out the pain, make it worse, then reveal the product as the answer.',
    structureInstructions: `Slide 0: Hook — name the problem in the viewer's own language. Make them feel seen.
Slides 1–2: Agitation — deepen the pain. Show the cost of NOT solving it. "And then it gets worse…"
Slide 3 (or middle): Solution reveal — introduce the product as the breakthrough. "That's when I found [product]."
Slides after reveal: Proof — one proof point per slide: stat, testimonial, before/after result.
Final slide: CTA — specific, urgency-driven.`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  transformation: {
    description: 'Before → journey → after → CTA. Show the relatable before state, the turning point, the transformation, the result.',
    structureInstructions: `Slide 0: Hook — the painful before state, described so vividly the viewer feels it. Relatable and specific.
Slides 1–2: The problem deepens — show what life looked like before, what wasn't working.
Middle slides: The turning point and journey — finding the solution, first results.
Slides near end: The after — concrete, aspirational results. Show the transformation.
Final slide: CTA — "Your turn. Link in bio." or similar.
IMAGE DIRECTION for this format: slide 0 should look messy/stressed/before; final body slides should look clean/bright/after.`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  feature_listicle: {
    description: '"N reasons / features" format. Hook promises a number, each body slide = one feature with its real-world benefit.',
    structureInstructions: `Slide 0: Hook — make the number promise. "5 things [product] does that [competitors] can't." or "The [product] features nobody talks about."
Each body slide: One feature = one slide. Feature name as headline (bold, short). Body text = the real benefit in plain language. Image = that feature in action or its outcome.
Final slide: CTA — "Try all 5 free. Link in bio." Reference the number from the hook.`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  ugc_testimonial: {
    description: 'First-person story arc. Written as if from a real user: "I was struggling with X until I found Y. Here\'s my honest experience."',
    structureInstructions: `Slide 0: Hook — first-person pain statement. "I was [doing old behavior] every day. It was exhausting." or "I almost gave up on [goal] until I tried this."
Slides 1–2: The struggle — specific details of the problem. Make it feel real, not scripted.
Middle slides: Discovery and results — "Then I tried [product]. Week 1: [result]. Week 2: [result]." Concrete, time-anchored progress.
Final body slide: Honest summary — "Is it worth it? Here's what I actually think."
Final slide (CTA): "Link in bio if you want to try it. Not sponsored — I just actually use it."
TONE: Casual, honest, slightly imperfect. No corporate language. Write like a real person talking to a friend.`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  product_lookbook: {
    description: 'Hook → 4–5 distinct use cases or scenarios → CTA. Each slide = a different world where this product belongs.',
    structureInstructions: `Slide 0: Hook — the overarching theme or promise. "One [product] for every part of your day." or "[Product] fits every version of you."
Each body slide: One use case / scenario / context. Different setting, different person (or same person in different role). Each slide must look and feel visually distinct.
Final slide: CTA — "Find your fit. Link in bio."
IMAGE DIRECTION: Each body slide must show a different aesthetic, location, or situation. Maximum variety. No two slides should look similar.`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
};

// ── Base system prompt ────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a TikTok slideshow content strategist who creates high-performing viral carousel slideshows.

WHAT A TIKTOK SLIDESHOW IS:
A TikTok slideshow is a sequence of 6–10 full-screen 9:16 portrait images the viewer swipes through left-to-right. Each slide is a background image with bold text overlaid. The text MUST be short (headline = 3–10 words) because it sits on top of the photo. The images must be designed with a clear empty zone where text can overlay without conflict.

CORE PRINCIPLES:
1. Every swipe must be earned — each slide must give the viewer a reason to keep going.
2. One idea per slide — never split a thought across two slides.
3. The image and headline must work together as a unit.
4. Text overlays: 6–10 words max per slide. Never explain — tease or deliver.
5. The final slide (CTA) must feel conclusive, not just appended.

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
- TikTok slideshows perform best with: authentic lo-fi phone aesthetic, real objects, warm natural light
- Vary the scenes across slides — different angles, subjects, and lighting per slide
- 3–5 sentences. Include the safe zone direction explicitly.

VISUAL INTENT RULES:
- safeTextRegion: where the image has clear empty space for text overlay. Alternate across slides.
- composition: one specific compositional instruction
- subjectFocus: the main visual subject
- lighting: the light source and quality
- colorMood: the color palette
- motionStyle: "Still" for static frames, or "Slight motion blur" for kinetic energy

CAPTION:
One TikTok caption for the whole slideshow. Under 100 characters. Hook-first. No hashtags.

Return ONLY a valid JSON object — no markdown fences, no explanation text.`;

// ── Product knowledge block ───────────────────────────────────────────

function buildKnowledgeBlock(knowledge: ProductKnowledge): string {
  const lines: string[] = ['\nPRODUCT KNOWLEDGE (use this to write specific, compelling copy):'];

  if (knowledge.usps.length > 0) {
    lines.push(`Key USPs: ${knowledge.usps.join(' | ')}`);
  }
  if (knowledge.painPoints.length > 0) {
    lines.push(`Customer pain points: ${knowledge.painPoints.join(' | ')}`);
  }
  if (knowledge.targetAudiencePainStatement) {
    lines.push(`Core pain (in customer words): "${knowledge.targetAudiencePainStatement}"`);
  }
  if (knowledge.targetAudienceDesiredOutcome) {
    lines.push(`What they want: "${knowledge.targetAudienceDesiredOutcome}"`);
  }
  if (knowledge.positioning) {
    lines.push(`Positioning: ${knowledge.positioning}`);
  }
  if (knowledge.proofPoints.length > 0) {
    const proofStr = knowledge.proofPoints
      .slice(0, 3)
      .map((p) => `[${p.type}] ${p.content}`)
      .join(' | ');
    lines.push(`Proof points: ${proofStr}`);
  }
  if (knowledge.differentiators.length > 0) {
    lines.push(`Differentiators: ${knowledge.differentiators.slice(0, 3).join(' | ')}`);
  }
  if (knowledge.contentAngles.length > 0) {
    lines.push(`Suggested content angles:\n${knowledge.contentAngles.slice(0, 3).map((a) => `  - ${a}`).join('\n')}`);
  }

  return lines.join('\n');
}

// ── User prompt builder ───────────────────────────────────────────────

function buildUserPrompt(input: GenerateSlideshowInput, slideCount: number): string {
  const format = input.storyFormat || 'hook_value_cta';
  const formatDef = STORY_FORMAT_DEFS[format];
  const kindPattern = formatDef.slideKindPattern(slideCount);
  const parts: string[] = [];

  parts.push(`Generate a TikTok slideshow with exactly ${slideCount} slides.`);

  parts.push(`\nPRODUCT:
Name: ${input.productName}
Description: ${input.productDescription}
Categories: ${input.productCategories.join(', ')}${input.productUrl ? `\nURL: ${input.productUrl}` : ''}`);

  if (input.productKnowledge) {
    parts.push(buildKnowledgeBlock(input.productKnowledge));
  }

  parts.push(`\nSLIDESHOW BRIEF:
${input.prompt}`);

  if (input.visualStyle && input.visualStyle !== 'reelfarm') {
    parts.push(`\nVISUAL STYLE: ${input.visualStyle}`);
  }

  if (input.characterModelDescription) {
    parts.push(`\nCHARACTER MODEL: A consistent human model appears in the images throughout this slideshow. Model description: ${input.characterModelDescription}. Reference images of this model will be passed separately to the image generator — write image prompts that feature this person naturally in the scene. Always name them "the model" in image prompts. Do NOT describe their appearance in the image prompt (the reference image handles consistency) — focus instead on their action, setting, and expression.`);
  }

  if (input.researchContext) {
    parts.push(`\nMARKET CONTEXT:\n${input.researchContext}`);
  }

  parts.push(`\nSTORY FORMAT: ${format.toUpperCase().replace(/_/g, ' ')}
${formatDef.description}

FORMAT INSTRUCTIONS:
${formatDef.structureInstructions}

${HOOK_FORMULA_BANK}`);

  parts.push(`\nSLIDE STRUCTURE (${slideCount} slides):
${kindPattern.map((kind, i) => `- Slide ${i}: kind "${kind}"`).join('\n')}

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

  let systemPrompt = BASE_SYSTEM_PROMPT;
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
