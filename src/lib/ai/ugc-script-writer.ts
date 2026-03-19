import OpenAI from 'openai';
import type { BrandVoice } from '@/lib/schemas';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

export type ScriptInput = {
  productName: string;
  productDescription: string;
  productCategories: string[];
  brandVoice?: BrandVoice;
  trendName?: string;
  trendFormat?: string;
  hooks?: string[];
  /** Script style: testimonial, problem-solution, review, routine, comparison */
  scriptStyle: string;
  /** Target duration in seconds */
  durationSeconds: number;
};

export type UGCScript = {
  script: string;
  hookLine: string;
  style: string;
  estimatedDurationSeconds: number;
};

const SCRIPT_STYLES: Record<string, string> = {
  testimonial: `TESTIMONIAL FORMAT: The speaker shares a genuine personal experience with the product. Structure: "I was struggling with [problem]... then I found [product]... and now [transformation]." Make it feel like a real person talking to a friend, not reading an ad.`,

  'problem-solution': `PROBLEM-SOLUTION FORMAT: Open with a relatable frustration, agitate it, then reveal the product as the fix. Structure: "You know that feeling when [pain point]? Yeah, I was SO over it. Then [product] came along and [specific result]." Direct, punchy, no fluff.`,

  review: `HONEST REVIEW FORMAT: The speaker gives a candid first-impression review. Structure: "Okay so I finally tried [product]... here's the honest truth: [genuine reaction]. What surprised me most was [specific detail]. Would I recommend it? [verdict]." Conversational, authentic, include one mild criticism for credibility.`,

  routine: `ROUTINE FORMAT: The speaker shows how the product fits naturally into their day. Structure: "So every morning I [routine], and [product] is the one thing I can't skip because [reason]. Here's how I use it: [specific steps]. Game changer." Casual, lifestyle-focused.`,

  comparison: `COMPARISON FORMAT: The speaker compares the product to what they used before. Structure: "I used to use [old solution] and honestly it was [frustration]. Switched to [product] and the difference is [specific comparison]. Here's what I noticed: [details]." Objective tone, specific comparisons.`,
};

/**
 * Write a natural, conversational UGC script for a TikTok video.
 * These scripts are designed to be read by an AI avatar (Creatify)
 * and should sound like a real person talking, not a polished ad.
 */
export async function writeUGCScript(input: ScriptInput): Promise<UGCScript> {
  const client = getClient();

  const styleGuide = SCRIPT_STYLES[input.scriptStyle] || SCRIPT_STYLES['problem-solution'];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You write TikTok UGC scripts that sound like a real person talking to their phone camera. NOT a polished ad — raw, natural, conversational.

Rules:
- Use filler words sparingly but naturally ("honestly", "literally", "okay so", "like")
- Short sentences. Fragments are fine. How people actually talk.
- Lead with emotion or a relatable moment, NOT the product name
- One idea per script. Don't try to say everything.
- Include natural pauses (use "..." for beats)
- The hook (first line) must stop the scroll — curiosity, controversy, or relatability
- End with a clear but casual CTA or takeaway
- Match the speaking pace to the duration — a 30-second script is about 75-80 words, a 60-second script is about 150-160 words
- No hashtags in the script — those go in the caption
- Sound like a 22-35 year old creator on TikTok, not a copywriter

Return valid JSON only.`,
      },
      {
        role: 'user',
        content: `Write a UGC TikTok script for this product:

Product: "${input.productName}"
Description: ${input.productDescription || 'Not provided'}
Categories: ${input.productCategories.join(', ')}
Target audience: ${input.brandVoice?.targetAudience || 'General audience'}
Brand tone: ${input.brandVoice?.tone || 'Not specified'}
${input.trendName ? `Trend to follow: "${input.trendName}" — ${input.trendFormat || ''}` : ''}
${input.hooks?.length ? `Hook inspiration: ${input.hooks.join('; ')}` : ''}

${styleGuide}

Target duration: ${input.durationSeconds} seconds (about ${Math.round(input.durationSeconds * 2.5)} words)

Return JSON:
{
  "script": "The full script text exactly as the creator would say it on camera",
  "hookLine": "Just the opening line (the scroll-stopper)",
  "style": "${input.scriptStyle}",
  "estimatedDurationSeconds": ${input.durationSeconds}
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  return JSON.parse(text);
}
