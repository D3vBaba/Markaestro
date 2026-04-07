import OpenAI from 'openai';
import type { BrandIdentity, BrandVoice, ImageStyle } from '@/lib/schemas';
import { generateAndUploadImage } from './image-generator';

/**
 * TikTok story-slideshow generator ("Photo Mode" carousels).
 *
 * Why this exists:
 * TikTok Photo Mode carousels average 4.00% engagement per view vs. 3.55% for
 * standard videos (+12%) — Socialinsider 2025. The format rewards content that
 * uses each swipe as a beat in a story, with a hook on slide 1, escalation in
 * the middle, and a payoff + CTA on the final slide.
 *
 * Research-backed defaults baked in here:
 * - 5–10 slides total. Drop-off climbs sharply after slide 7, so we hard-cap
 *   at 10 and default to 7. (Sources: Affinco 2025, Shopify TikTok slideshow
 *   guide 2026, usevisuals.com TikTok carousel best practices.)
 * - Slide 1 must be a scroll-stopper hook (bold question, claim, or pattern
 *   interrupt). Without this the rest of the carousel doesn't matter.
 * - Story structure follows Problem → Agitation → Solution → Proof → CTA
 *   (PAS+CTA), the framework usevisuals.com / postnitro.ai cite as the
 *   highest-converting carousel template.
 * - Final slide must have an explicit save/follow CTA — TikTok's algorithm
 *   weights saves heavily for carousels.
 * - 9:16 vertical (1080×1920) is the only aspect ratio that doesn't get
 *   letterboxed in the FYP.
 * - Image style is forced to photorealistic UGC variants because the same
 *   research that says "raw UGC wins on TikTok" applies to carousels too —
 *   polished commercial slides get skipped just like polished video ads do.
 */

// ── Types ────────────────────────────────────────────────────────────

export type SlideStoryStyle =
  | 'problem-solution' // Classic PAS+CTA: pain → agitate → product → proof → CTA
  | 'listicle' // "5 things I wish I knew about X" — educational
  | 'transformation' // Before → journey → after, story-shaped
  | 'storytime' // First-person narrative ("POV: you just...")
  | 'mythbusting'; // "Stop doing X. Do Y instead" — contrarian hook

export type TikTokSlideshowRequest = {
  productName: string;
  productDescription?: string;
  productCategories?: string[];
  brandIdentity?: BrandIdentity;
  brandVoice?: BrandVoice;
  /** 5–10. Defaults to 7 (the inflection point before drop-off climbs). */
  slideCount?: number;
  storyStyle?: SlideStoryStyle;
  /** Optional creative angle from the user. */
  hint?: string;
};

export type SlidePlan = {
  /** 1-indexed slide number. */
  index: number;
  /** What the camera sees — fed to the image generator. */
  visualPrompt: string;
  /** The text overlay the user should put on this slide in TikTok's editor. */
  overlayText: string;
  /** Why this slide exists in the story arc — useful for the UI tooltip. */
  beat: string;
};

export type TikTokSlideshowPlan = {
  hookLine: string;
  /** Suggested caption (200+ chars per TikTok algorithm research). */
  caption: string;
  hashtags: string[];
  slides: SlidePlan[];
};

export type TikTokSlideshowResult = TikTokSlideshowPlan & {
  /** Uploaded image URL for each slide, indexed to match `slides`. */
  slideImageUrls: string[];
  /** Slides that failed image generation (empty on full success). */
  failedSlideIndices: number[];
};

// ── Story planner ────────────────────────────────────────────────────

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

const STORY_STYLE_BRIEFS: Record<SlideStoryStyle, string> = {
  'problem-solution':
    'Slide 1 = visceral pain point hook. Slides 2–3 = agitate the pain (make the cost of NOT solving it real). Middle slide = the product reveal as the answer. Next-to-last = proof / result / before-after. Last = CTA to save or follow.',
  'listicle':
    'Slide 1 = title hook with a number ("5 things I wish I knew before buying X"). Each middle slide = ONE numbered insight, concrete and surprising. Last slide = recap + save/follow CTA.',
  'transformation':
    'Slide 1 = the "before" state with a confessional hook ("I used to..."). Middle slides = the turning point and the messy middle. Penultimate = the "after" reveal. Last = CTA tying the transformation back to the product.',
  'storytime':
    'Slide 1 = first-person POV hook ("POV: you just discovered..."). Each middle slide advances the narrative one beat — like a comic strip. Last slide = the punchline + CTA.',
  'mythbusting':
    'Slide 1 = contrarian claim ("Stop doing X."). Slide 2 = why everyone gets it wrong. Middle slides = the correct approach, demonstrated with the product. Last = CTA + save reminder.',
};

async function planSlideshow(
  req: TikTokSlideshowRequest,
): Promise<TikTokSlideshowPlan> {
  const slideCount = Math.min(Math.max(req.slideCount ?? 7, 5), 10);
  const storyStyle = req.storyStyle ?? 'problem-solution';
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You design TikTok Photo Mode (carousel) story slideshows that go viral.

Hard rules from TikTok carousel research:
- Slide 1 MUST be a scroll-stopping hook. Bold claim, pattern interrupt, or question that demands an answer. If slide 1 fails nothing else matters.
- Each slide is ONE clear beat in a story arc. No slide is filler.
- Overlay text per slide: 4–14 words. Punchy. Reads in <2 seconds.
- Visual prompts are RAW UGC photo style — phone-shot, natural light, real environments, NO logos, NO graphic overlays, NO commercial polish. The slides should look like a real person took them, not a brand.
- Each slide must be visually DIFFERENT from the others (different angle, setting, framing, or subject).
- The product appears recognizably in at least 3 slides (including the reveal and the CTA slide), but not all slides — the story is the point, not the product.
- Final slide ALWAYS has a save/follow CTA. TikTok's algorithm weights saves heavily on carousels.
- Caption: 200+ characters, conversational, includes 1 question to drive comments.
- Hashtags: 4–6, mix of one broad + niche tags, no #fyp.

Story framework for THIS slideshow: ${STORY_STYLE_BRIEFS[storyStyle]}

Return valid JSON only.`,
      },
      {
        role: 'user',
        content: `Design a ${slideCount}-slide TikTok carousel for:

Product: "${req.productName}"
Description: ${req.productDescription || 'Not provided'}
Categories: ${req.productCategories?.join(', ') || 'General'}
Brand tone: ${req.brandVoice?.tone || 'Authentic, conversational'}
${req.hint ? `Creative angle from the user: ${req.hint}` : ''}

Return JSON in this exact shape:
{
  "hookLine": "The single line that hooks the viewer on slide 1",
  "caption": "200+ character caption with one question",
  "hashtags": ["tag1", "tag2", "tag3", "tag4"],
  "slides": [
    {
      "index": 1,
      "visualPrompt": "Raw phone-shot description of what's in frame on this slide",
      "overlayText": "The 4–14 word text overlay for this slide",
      "beat": "What story beat this slide carries (e.g. 'hook', 'agitation', 'reveal', 'proof', 'CTA')"
    }
  ]
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text) as TikTokSlideshowPlan;

  // Defensive: enforce slide count and re-index in case the model drifted.
  parsed.slides = (parsed.slides || []).slice(0, slideCount).map((s, i) => ({
    ...s,
    index: i + 1,
  }));

  return parsed;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Plan a slideshow + generate one image per slide in parallel.
 *
 * If individual slide images fail, the corresponding `slideImageUrls` entry is
 * an empty string and the index is reported in `failedSlideIndices` so the UI
 * can offer a retry button per slide rather than blowing up the whole batch.
 */
export async function generateTikTokSlideshow(
  req: TikTokSlideshowRequest,
  workspaceId: string,
): Promise<TikTokSlideshowResult> {
  const plan = await planSlideshow(req);

  // Generate images for every slide in parallel. We force photorealistic + the
  // tiktok channel so the existing per-channel variant biasing in
  // image-generator.ts pulls from the raw UGC variant pool (indices 5–7).
  const photorealistic: ImageStyle = 'photorealistic';
  const settled = await Promise.allSettled(
    plan.slides.map((slide) =>
      generateAndUploadImage(
        {
          prompt: slide.visualPrompt,
          promptMode: 'guided',
          productName: req.productName,
          productDescription: req.productDescription,
          productCategories: req.productCategories,
          brandIdentity: req.brandIdentity,
          brandVoice: req.brandVoice,
          channel: 'tiktok',
          style: photorealistic,
          aspectRatio: '9:16',
          provider: 'gemini',
        },
        workspaceId,
      ),
    ),
  );

  const slideImageUrls: string[] = [];
  const failedSlideIndices: number[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      slideImageUrls.push(s.value.imageUrl);
    } else {
      slideImageUrls.push('');
      failedSlideIndices.push(plan.slides[i].index);
    }
  });

  return {
    ...plan,
    slideImageUrls,
    failedSlideIndices,
  };
}
