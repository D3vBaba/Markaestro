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
  prompt?: string;
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
    description: 'Hook → value stack → CTA. The universal TikTok format. Hook stops the scroll with a bold claim or curiosity gap, each body slide delivers one punchy insight or benefit, the CTA drives action.',
    structureInstructions: `Slide 0 (HOOK): 3–7 word stop-the-scroll opener. Use a curiosity gap, bold claim, or relatable confession. "I spent $30 on this and now I can't stop." "Nobody told me this worked." "Stop doing this if you want [result]."
Middle slides (BODY): ONE idea per slide. Max 2 short sentences. Each slide must make the viewer feel they'll miss something if they stop swiping. End each body slide with an implied "but wait…" — the next slide is the payoff.
Final slide (CTA): Short, direct, specific action. "Link in bio." "Save this." "Try it free — link in bio." NOT "Follow for more." — that's dead copy. Give them a reason to click NOW.
CLIFFHANGER RULE: Each slide from 1 to N-1 must leave something slightly unresolved. The viewer swipes to get the answer. The CTA is the only slide that fully resolves.`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  problem_solution: {
    description: 'Problem → agitation → solution reveal → proof → CTA. Name the pain, make it feel worse, then reveal the product as the escape hatch.',
    structureInstructions: `Slide 0 (HOOK): Name the exact problem in the viewer's own words. Specific and relatable. "If your [pain point] is ruining your [goal], keep reading." or "[Number] signs your [thing] is the problem."
Slides 1–2 (AGITATION): Make the problem feel bigger and more urgent. "And it's not just [X]… it's also [Y]." Show the cost of NOT solving it. One problem dimension per slide. Short sentences.
Middle slide (REVEAL): The pivot. "That changed when I found [product]." or "Then I tried [product] and here's what happened." Keep it short — the curiosity does the work.
Slides after reveal (PROOF): One proof point per slide. Stat, specific result, before/after. "Lost 8 lbs in 3 weeks." "Saved 4 hours a week." Specific beats vague every time.
Final slide (CTA): Urgency-anchored. "Limited spots." "Link in bio before it sells out." "Grab it — link below."
TONE: First-person confessional. Honest and specific. Never corporate.`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  transformation: {
    description: 'Before → turning point → after → CTA. Relatable before state, the discovery, the tangible transformation. Emotional arc that mirrors the viewer\'s own desire.',
    structureInstructions: `Slide 0 (HOOK): The painful before state in vivid, specific language. Make the viewer feel it. "I was waking up exhausted every single day." "My skin looked like this for 3 years." Short and raw.
Slides 1–2 (BEFORE): Deepen the before. Specific details — what daily life looked like, what wasn't working, what they'd already tried. Real and relatable. No resolution yet.
Middle slides (TURNING POINT + JOURNEY): The moment of discovery and early results. "Week 1: [small change]." "By day 10: [something noticeable]." Time-anchored, specific, building momentum.
Slides near end (AFTER): The result. Concrete and aspirational. Numbers, visible changes, emotional payoff. Show the transformation without overselling.
Final slide (CTA): "Your turn." + specific action. Link in bio, try free, etc.
IMAGE DIRECTION: Hook/before slides should feel slightly desaturated or tense. After/CTA slides should feel warm, open, and resolved.`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  feature_listicle: {
    description: '"N things about [product]" format. Hook makes a number promise. Each body slide = one feature with its real-world payoff. Satisfying to swipe through.',
    structureInstructions: `Slide 0 (HOOK): Make the number promise with a curiosity gap. "5 things [product] does that [competitor] doesn't." "The 4 [product] features nobody talks about." "I found [number] reasons to never go back."
Each body slide: Feature name as headline (bold, 2–4 words). Body text = the actual benefit to the user in plain language — why they should care. One feature, one slide, max 2 sentences. End with a partial reveal: "But the best one is next…"
Final body slide: The best/most surprising feature — save the best for last to reward swipers.
CTA slide: Reference the number from the hook. "All [N] work together. Link in bio to try free." or "See all [N] features — link below."`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  ugc_testimonial: {
    description: 'First-person story arc. Written as if a real person is talking directly to camera. "I was [struggling]. Then I found [product]. Here\'s the honest truth." The most trusted format on TikTok.',
    structureInstructions: `Slide 0 (HOOK): First-person pain hook. "I wasted [time/money] on [old solution] before I found this." "She didn't believe me until she tried it herself." "Not sponsored. I paid for this. Here's what happened." Raw and direct.
Slides 1–2 (THE STRUGGLE): The specific, detailed story of the problem. Dates, amounts, feelings. "For 6 months I tried everything." Make it real — the more specific, the more credible.
Middle slides (DISCOVERY + RESULTS): "Then I found [product]." "Day 3: [tiny result]." "Week 2: [bigger result]." Time-anchored and concrete. Each slide is one chapter of the story.
Final body slide: The honest verdict. "Is it worth it? Here's my real answer." Sets up the CTA without overselling.
CTA slide: "Link in bio if you want to try it." "Not an ad — I just genuinely use this every day." The low-pressure close is what makes UGC convert.
TONE: Casual, direct, slightly imperfect. Contractions. Short sentences. Write like you're texting a friend. NEVER say "amazing", "game-changer", "incredible", "revolutionary", or "seamless".`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
  product_lookbook: {
    description: 'Hook → 4–5 distinct scenes or use cases → CTA. Each slide = a different moment in the viewer\'s life where this product belongs. Visual variety is the entire point.',
    structureInstructions: `Slide 0 (HOOK): The overarching curiosity hook. "One [product] for every version of your day." "I've been using this in [unexpected way] and it's changed everything." Creates the expectation of seeing multiple angles.
Each body slide (SCENARIOS): One distinct scene, context, or use case per slide. Different setting, different mood, different angle. Each must look and feel visually unique from the last. The copy names the scenario: "8AM: [use case]." "Post-gym: [use case]." "Late night: [use case]."
CLIFFHANGER: After each scenario, tease the next. "And then there's the [next scenario]…" Keep the swiping momentum.
CTA slide: Bring it back to the full picture. "All of this, one [product]. Link in bio." or "Every version of you. Link below."
IMAGE DIRECTION: Maximum visual variety across slides — different times of day, different environments, different energy. No two slides should share the same setting or lighting.`,
    slideKindPattern: (n) => ['hook', ...Array(n - 2).fill('body'), 'cta'],
  },
};

// ── Base system prompt ────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a TikTok slideshow content strategist who creates high-performing viral photo-mode slideshows.

WHAT A TIKTOK PHOTO-MODE SLIDESHOW IS:
A TikTok slideshow is a sequence of 6–10 full-screen 9:16 portrait photos the viewer swipes through left-to-right. Each slide is a candid, real-world lifestyle photo with BOLD TEXT overlaid on top. The images look like UGC — real people in real places, shot on a phone, not studio photography. Bold white text (with drop shadow) appears in the top and/or bottom of each image.

THE AESTHETIC THAT WORKS:
- Images: candid, lifestyle, "iPhone photo" quality — people sitting on benches, walking outside, shot from behind, side angles, natural settings. NOT studio portraits, NOT stock photography, NOT posed headshots.
- Text: SHORT, PUNCHY, EMOTIONAL — 3–10 words per slide. Written like a person thinking out loud, not a marketer writing copy.
- Tone: first-person confessional, curiosity-driven, emotionally honest. "I tried this and…" "She didn't believe me until…" "Nobody talks about this."

CORE PRINCIPLES:
1. Every swipe must be EARNED — each slide ends with an unresolved tension that makes the viewer need the next one.
2. One idea per slide — one headline, one emotional beat, one piece of information.
3. CLIFFHANGER PROGRESSION: slides 1 through N-1 each leave something unresolved. The CTA is the payoff.
4. The image and headline work together — the image sets the scene, the text delivers the emotional punch.
5. The CTA must feel earned and conclusive, not just "follow for more."

HEADLINE RULES:
- Hook: 3–8 words. Stops the scroll. Curiosity gap, bold claim, pattern interrupt, or relatable confession.
- Body: 2–10 words. ONE complete thought. Must provoke a "wait, tell me more" reaction that drives the swipe.
- CTA: 4–10 words. Specific action + concrete payoff. "Link in bio." "Save this." Never vague.
- NEVER use: "amazing", "incredible", "game-changer", "revolutionary", "mindblowing", "seamlessly", "effortlessly"
- ALWAYS prefer: specific numbers, real emotions, surprising facts, first-person honesty

IMAGE PROMPT RULES (CRITICAL — these images will have text overlaid on them):
- Describe a CANDID LIFESTYLE SCENE — real people in real places doing real things. NOT studio shots.
- Camera angle: behind-the-back, over-shoulder, side profile, low angle, or candid seated. NEVER straight-on headshots.
- Environment: outdoor park, city street, cafe, home setting — with natural light. NOT neutral studio backgrounds.
- The image MUST have clear empty space in the TOP 20% AND BOTTOM 15% for bold text overlay.
- iPhone photo aesthetic: warm, slightly desaturated, natural grain, real-world colors. NOT HDR, NOT oversaturated.
- No readable text, no signs, no labels, no logos anywhere in the image.
- Vary scenes, angles, and environments across all slides — each must look like a different moment.
- 3–5 sentences. State the camera angle explicitly. State which zone is kept clear for text.

IMAGE PROMPT EXAMPLES (right vs. wrong):
❌ WRONG: "A professional woman in a well-lit studio faces the camera holding the product. Clean white background. Direct confident eye contact."
✅ RIGHT: "Behind-the-back shot of a woman walking through a sunlit city street, product visible in her hand at her side. Soft golden hour light, slight motion blur on passing pedestrians. The top 20% of frame is open sky, clear for text overlay."

❌ WRONG: "A model poses in front of a plain background wearing the product, studio lighting highlights the details."
✅ RIGHT: "Over-shoulder angle capturing a woman sitting on a park bench, glancing down at the product resting on her lap. Dappled natural light through tree canopy, blurred green background. Bottom 20% shows bench wood grain — clear for text overlay."

❌ WRONG: "Clean product shot with professional lighting showing all features."
✅ RIGHT: "Side-profile street photography angle — a person mid-stride on a busy sidewalk, product in hand, not looking at camera. Warm overcast light, shallow depth of field blurring city storefronts behind. Top 20% is open sky, clear for text."

VISUAL INTENT RULES:
- safeTextRegion: where the primary text block goes ("top", "middle", or "bottom"). Alternate across slides.
- composition: MUST be one of these five camera angles ONLY — write exactly which one: "Behind-the-back shot — camera behind and to the side of the subject, we see their back and the world ahead", "Over-shoulder angle — camera slightly behind and to one side, subject's shoulder/ear visible, POV energy", "Side-profile street photography — 90-degree side angle, subject mid-action, face in profile", "Low angle looking up — camera at waist/knee height, subject looms larger than life", or "Candid seated — subject on bench/cafe chair/steps, camera at eye level, subject looking at phone or into distance". NEVER write a frontal shot, headshot, close-up of face, or any framing where the subject faces the camera.
- subjectFocus: what the subject IS DOING in the scene (walking, seated and scrolling phone, standing at a street corner, etc.). NEVER write "looking at camera", "facing camera", "making eye contact", "direct gaze", "confident stance toward camera", or any variation of frontal posing.
- lighting: natural light source (golden hour, overcast, indoor window light, etc.)
- colorMood: warm/cool, saturated/muted, the overall color feel
- motionStyle: "Still" for a frozen moment, or "Slight motion" for walking/moving shots

CAPTION:
One TikTok caption for the whole slideshow. Under 100 characters. Hook-first, conversational. No hashtags.

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

// ── Auto-prompt builder ───────────────────────────────────────────────
//
// When the user provides no prompt, synthesise a concise brief from the
// product knowledge store so the generator still has a clear directive.

function buildAutoPrompt(input: GenerateSlideshowInput): string {
  const k = input.productKnowledge;
  const parts: string[] = [];

  if (k?.contentAngles?.length) {
    parts.push(`Focus angle: ${k.contentAngles[0]}.`);
  }

  if (k?.targetAudiencePainStatement) {
    parts.push(`Audience pain: ${k.targetAudiencePainStatement}.`);
  } else if (k?.targetAudienceDesiredOutcome) {
    parts.push(`Audience goal: ${k.targetAudienceDesiredOutcome}.`);
  }

  if (k?.usps?.length) {
    parts.push(`Lead with: ${k.usps[0]}.`);
  }

  if (k?.positioning) {
    parts.push(`Positioning: ${k.positioning}.`);
  }

  if (parts.length === 0) {
    parts.push(`Create a compelling slideshow that showcases ${input.productName}'s key benefits and drives action.`);
  }

  return parts.join(' ');
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

  const effectivePrompt = input.prompt?.trim() || buildAutoPrompt(input);
  parts.push(`\nSLIDESHOW BRIEF:\n${effectivePrompt}`);

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
      "imagePrompt": "3–5 sentence CANDID LIFESTYLE scene. MUST use behind-back/over-shoulder/side-profile/low-angle/candid-seated framing — NEVER frontal or studio. Real outdoor/indoor location, natural light only. State the camera angle explicitly. State which zone (top/bottom 20%) is clear for text.",
      "visualIntent": {
        "composition": "MUST be one of the 5 angles: behind-the-back / over-shoulder / side-profile / low-angle-looking-up / candid-seated. Write the full description. NEVER frontal or headshot.",
        "subjectFocus": "what the subject IS DOING — action verb required. NEVER 'looking at camera', 'facing camera', or any frontal posing.",
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
