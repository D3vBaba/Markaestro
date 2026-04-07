import OpenAI from 'openai';
import crypto from 'crypto';
import type { SocialChannel } from '@/lib/schemas';

/**
 * Image scene interpreter.
 *
 * The OLD image generator routed products into hardcoded category buckets via
 * keyword matching (FASHION-TECH, BEAUTY, FOOD, etc.). That caused two failure
 * modes the user explicitly called out:
 *
 *   1. Everything collapsed to fashion clichés if the product description had
 *      ANY clothing-adjacent word — even when the product was a meditation app
 *      that happened to mention "lifestyle".
 *   2. Outputs never showed the *actual subject the viewer needs to see* —
 *      e.g. clothing without a person wearing it, or an app without the UI in
 *      a hand. The model never understood what the product actually does.
 *
 * The fix: read the product + post context with an LLM and produce a
 * structured `SceneIntent` describing what MUST appear, what setting makes
 * sense, and what would feel wrong — then feed that intent to the image
 * generator as the spine of the prompt instead of keyword-routed pools.
 *
 * This is interpretation-first, not keyword-first. The scene interpreter is
 * the only place that should be making "what should this image actually show"
 * decisions.
 */

// ── Types ────────────────────────────────────────────────────────────

export type SceneIntent = {
  /**
   * One sentence describing what the product/page actually IS and DOES.
   * Forces the LLM to demonstrate it understood the product before deciding
   * what to depict.
   */
  productInOneLine: string;

  /**
   * The single most important thing the viewer must see in this image.
   * Examples: "a woman wearing the linen jumpsuit on a sunlit balcony",
   * "a hand holding an iPhone with the meal-planning app's home screen
   * visible", "a runner mid-stride wearing the trail shoes on a forest path".
   */
  primarySubject: string;

  /**
   * 1–3 elements that MUST appear in frame for this image to be useful for
   * marketing this product. The image generator treats these as hard
   * requirements, not suggestions.
   */
  requiredElements: string[];

  /**
   * Where this scene plausibly takes place. A real, specific location, not
   * a vague vibe. "A sunlit Brooklyn coffee shop window seat at 9am" not
   * "modern lifestyle setting".
   */
  setting: string;

  /**
   * What human(s) appear and what they're doing. Empty string if a person
   * genuinely isn't required (rare — most products benefit from a person).
   */
  humanPresence: string;

  /**
   * 2–4 things that would be wrong, off-brand, or generic for THIS specific
   * product. E.g. for a meditation app: "neon nightlife energy", "stock
   * smiling people". For streetwear: "luxury yacht", "boardroom".
   */
  avoid: string[];

  /**
   * The emotional beat the image should land — one phrase. Used to bias
   * lighting and composition choices downstream.
   */
  emotionalBeat: string;
};

export type SceneIntentRequest = {
  productName?: string;
  productDescription?: string;
  productCategories?: string[];
  /** The post text / caption / scene brief the user provided. */
  postText: string;
  channel?: SocialChannel;
};

// ── Cache ────────────────────────────────────────────────────────────

// In-memory per-instance cache. Same pattern as research-cache. Keyed on a
// hash of the inputs that meaningfully change the interpretation.
const CACHE = new Map<string, { value: SceneIntent; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — long enough to dedupe a
// burst of N image generations on the same post, short enough that edits to
// the product description take effect within a session.

function cacheKey(req: SceneIntentRequest): string {
  const material = JSON.stringify({
    n: req.productName || '',
    d: (req.productDescription || '').slice(0, 400),
    c: (req.productCategories || []).join(','),
    p: req.postText.slice(0, 600),
    ch: req.channel || '',
  });
  return crypto.createHash('sha1').update(material).digest('hex');
}

// ── LLM call ─────────────────────────────────────────────────────────

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

const SYSTEM_PROMPT = `You are an art director planning a single marketing image for a product.

Your job is to READ the product information and post text and decide what the image should actually show. You must demonstrate that you understood what the product is and does *before* deciding what to depict.

Hard rules — these are non-negotiable:
1. The image must visually represent what the product DOES, not just what category it belongs to. A clothing brand image should show clothing being worn. An app image should show the app being used (UI visible in a phone in a hand, OR the human outcome the app enables). A food product image should show the food in the context of being eaten or made.
2. Do NOT default to fashion / nightlife / street style imagery unless the product is genuinely fashion-forward and the post is about that. Many products that mention "lifestyle" or "style" are not fashion products. Read carefully.
3. If a person belongs in the frame, say exactly who they are (age range, what they're doing, what they're wearing if relevant) and what they're interacting with. Don't say "a person" — say "a woman in her 30s sketching in a notebook at a coffee shop window".
4. The setting must be a specific, plausible real place — not "modern lifestyle setting" or "aspirational environment".
5. The "avoid" list must be tailored to THIS product. Generic "no stock photos" is useless. Say what would be specifically wrong: "no nightclub neon for this meditation app", "no business suits for this streetwear brand".
6. requiredElements are HARD requirements — only list what truly cannot be missing. For clothing: a person actually wearing the garment. For an app: the app UI visible somewhere in the frame OR a clear depiction of the activity it enables.

Return JSON only.`;

async function callInterpreter(req: SceneIntentRequest): Promise<SceneIntent> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.4,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Plan an image for this product on ${req.channel || 'social media'}.

Product name: ${req.productName || '(not provided)'}
Product description: ${req.productDescription || '(not provided)'}
Product categories: ${req.productCategories?.join(', ') || '(not provided)'}

Post text / scene brief from the marketer:
"""
${req.postText.slice(0, 1500)}
"""

Return JSON with this exact shape:
{
  "productInOneLine": "One sentence: what is this product and what does it actually do for the user?",
  "primarySubject": "The single most important thing the viewer must see",
  "requiredElements": ["element 1", "element 2"],
  "setting": "A specific real place, not a vague vibe",
  "humanPresence": "Who is in the frame and what they're doing — or empty string if no human is needed",
  "avoid": ["thing specific to this product to avoid", "another"],
  "emotionalBeat": "one phrase"
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text) as Partial<SceneIntent>;

  // Defensive shape coercion. The LLM can occasionally return strings where
  // arrays are expected — coerce rather than throw, since a malformed intent
  // is still better than no intent (and far better than the keyword fallback).
  return {
    productInOneLine: String(parsed.productInOneLine || '').trim(),
    primarySubject: String(parsed.primarySubject || '').trim(),
    requiredElements: Array.isArray(parsed.requiredElements)
      ? parsed.requiredElements.map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
      : [],
    setting: String(parsed.setting || '').trim(),
    humanPresence: String(parsed.humanPresence || '').trim(),
    avoid: Array.isArray(parsed.avoid)
      ? parsed.avoid.map((s) => String(s).trim()).filter(Boolean).slice(0, 5)
      : [],
    emotionalBeat: String(parsed.emotionalBeat || '').trim(),
  };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Interpret the product + post context into a structured scene intent.
 *
 * Returns null on failure so the caller can fall back to the legacy
 * keyword-routed assembly path. We log failures with context so we can spot
 * if the fallback is firing in production — silent failures here would
 * silently regress everyone back to the bad behavior.
 */
export async function interpretSceneIntent(
  req: SceneIntentRequest,
): Promise<SceneIntent | null> {
  // Skip the call entirely if there's no usable product context AND no post
  // text — the LLM has nothing to interpret and would just hallucinate.
  if (!req.productName && !req.productDescription && !req.postText.trim()) {
    return null;
  }

  const key = cacheKey(req);
  const cached = CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const value = await callInterpreter(req);
    // Reject empty interpretations — if the LLM returned essentially nothing
    // we'd rather fall back to the legacy path than feed garbage downstream.
    if (!value.primarySubject && !value.setting) {
      console.warn('[image-scene-interpreter] Empty interpretation — falling back', {
        productName: req.productName,
      });
      return null;
    }
    CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.error('[image-scene-interpreter] Failed — falling back to keyword routing', {
      productName: req.productName,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

/**
 * Render a SceneIntent into the prompt block consumed by the image generator.
 * Kept here (not in image-generator.ts) so the prompt shape lives next to the
 * type definition — anyone editing one will see the other.
 */
export function renderSceneIntent(intent: SceneIntent): string {
  const lines: string[] = [];

  lines.push('SCENE INTENT (interpreted from the product and post — this is the source of truth for what the image must show):');
  if (intent.productInOneLine) lines.push(`What this product is: ${intent.productInOneLine}`);
  if (intent.primarySubject) lines.push(`PRIMARY SUBJECT (must be visually dominant): ${intent.primarySubject}`);

  if (intent.requiredElements.length > 0) {
    lines.push('REQUIRED ELEMENTS (these MUST be visible in frame — the image is wrong without them):');
    intent.requiredElements.forEach((el) => lines.push(`  • ${el}`));
  }

  if (intent.setting) lines.push(`SETTING: ${intent.setting}`);
  if (intent.humanPresence) lines.push(`PEOPLE IN FRAME: ${intent.humanPresence}`);
  if (intent.emotionalBeat) lines.push(`EMOTIONAL BEAT: ${intent.emotionalBeat}`);

  if (intent.avoid.length > 0) {
    lines.push('AVOID (specific to this product — these would be wrong, off-brand, or generic):');
    intent.avoid.forEach((a) => lines.push(`  • ${a}`));
  }

  return lines.join('\n');
}
