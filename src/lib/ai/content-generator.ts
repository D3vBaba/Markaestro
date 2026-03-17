import OpenAI from 'openai';
import type { BrandVoice } from '@/lib/schemas';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

export type ContentRequest = {
  type: 'email_subject' | 'email_body' | 'social_post' | 'ad_copy' | 'full_campaign';
  productName?: string;
  productDescription?: string;
  /** Product categories like saas, mobile, fashion, etc. */
  productCategories?: string[];
  targetAudience?: string;
  channel?: string;
  tone?: string;
  additionalContext?: string;
  brandVoice?: BrandVoice;
};

export type ContentResponse = {
  content: string;
  suggestions?: string[];
};

const SYSTEM_PROMPT = `You are a direct-response copywriter who writes social media content that makes people stop scrolling. Your content follows one core principle: lead with a SPECIFIC pain point the audience feels, then position the product as the solution.

Your process for every piece of content:
1. IDENTIFY a real, specific frustration or desire the target audience has (not generic "grow your business" — think "You just lost another customer because your checkout page loaded in 4 seconds")
2. OPEN with that pain point or desire — make the reader feel seen
3. BRIDGE to how the product solves it — be concrete, not vague
4. CLOSE with a reason to act now

Writing rules:
- Never start with the product name. Start with the reader's world.
- Use "you" language. Talk TO the reader, not ABOUT the product.
- One idea per post. Don't try to say everything.
- Be specific over clever. "Save 3 hours per week" beats "Save time."
- No generic filler: "excited to announce", "we're thrilled", "check out our amazing..."
- No clickbait or misleading claims.
- Sound like a person, not a press release.
- Every sentence should earn its place. Cut anything that doesn't add value.`;

function buildBrandVoiceBlock(bv: BrandVoice): string {
  const parts: string[] = [];
  parts.push('\n\n--- BRAND VOICE GUIDELINES ---');
  if (bv.tone) parts.push(`Tone: ${bv.tone}`);
  if (bv.style) parts.push(`Style: ${bv.style}`);
  if (bv.keywords.length > 0) parts.push(`Keywords to incorporate naturally: ${bv.keywords.join(', ')}`);
  if (bv.avoidWords.length > 0) parts.push(`Words/phrases to NEVER use: ${bv.avoidWords.join(', ')}`);
  if (bv.cta) parts.push(`Preferred CTA: ${bv.cta}`);
  if (bv.targetAudience) parts.push(`Target Audience: ${bv.targetAudience}`);
  if (bv.sampleVoice) parts.push(`Sample voice (match this style closely):\n"${bv.sampleVoice}"`);
  parts.push('--- END BRAND VOICE ---');
  return parts.join('\n');
}

/**
 * Channel-specific constraints based on engagement research:
 * - X: 71-100 chars gets 17% more engagement; retweets peak at 71-100 chars
 * - Facebook: 40-80 chars gets 66% higher engagement
 * - Instagram: under 150 chars for short posts; first 125 chars show before "more"
 * - TikTok: captions are secondary to video — keep under 100 chars
 */
function getChannelConstraints(channel?: string, contentType?: string): string {
  const isShort = contentType === 'social_post';

  switch (channel) {
    case 'x':
      return [
        isShort
          ? 'FORMAT: X/Twitter post. AIM for 71-100 characters (this range gets 17% more engagement). MUST be under 280.'
          : 'FORMAT: X/Twitter post. MUST be under 280 characters.',
        'Style: punchy, conversational, opinion-driven. One strong thought — not a paragraph.',
        'Structure: Hook → insight or product tie-in. That\'s it.',
        'No hashtags unless they add real value. No filler words.',
      ].join('\n');
    case 'facebook':
      return [
        isShort
          ? 'FORMAT: Facebook post. AIM for 40-80 characters (posts this length get 66% higher engagement). Max 2 sentences.'
          : 'FORMAT: Facebook post. Keep it under 3 short sentences.',
        'Style: direct and conversational. Get to the point fast — Facebook users scroll fast.',
        'Structure: One punchy line about the pain point or benefit → CTA or question.',
        'No paragraph-length posts for short content. Emojis only if they fit the brand.',
      ].join('\n');
    case 'instagram':
      return [
        isShort
          ? 'FORMAT: Instagram caption. AIM for 125-150 characters (the sweet spot for engagement). 1-2 sentences max.'
          : 'FORMAT: Instagram caption. Keep the first line under 125 characters (that\'s what shows before "more").',
        'Style: visual, aspirational but authentic. Every word must earn its place.',
        'Structure: Strong hook line → product connection or CTA.',
        'Hashtags: 3-5 relevant ones AFTER the caption, separated by a line break.',
      ].join('\n');
    case 'tiktok':
      return [
        isShort
          ? 'FORMAT: TikTok caption. AIM for under 100 characters. One sentence.'
          : 'FORMAT: TikTok caption. Keep it under 150 characters.',
        'Style: casual, raw, authentic. TikTok rewards honesty and humor over polish.',
        'Structure: One bold statement or question. That\'s it.',
        'Hashtags: 2-3 niche-relevant ones.',
      ].join('\n');
    default:
      return isShort
        ? 'FORMAT: Social media post. Keep it under 150 characters — 1-2 sentences max.'
        : 'FORMAT: Social media post. Keep it concise and engaging.';
  }
}

function buildContentPrompt(request: ContentRequest): string {
  const product = request.productName || 'the product';
  const desc = request.productDescription || '';
  const audience = request.targetAudience || request.brandVoice?.targetAudience || '';
  const categories = request.productCategories || [];
  const context = request.additionalContext || '';

  const productBlock = [
    '--- PRODUCT ---',
    `Name: ${product}`,
    desc ? `What it does: ${desc}` : '',
    categories.length > 0 ? `Category: ${categories.join(', ')}` : '',
    audience ? `Target audience: ${audience}` : '',
    context ? `Additional context: ${context}` : '',
    '--- END PRODUCT ---',
  ].filter(Boolean).join('\n');

  return productBlock;
}

export async function generateContent(request: ContentRequest): Promise<ContentResponse> {
  const client = getClient();

  const productBlock = buildContentPrompt(request);
  const channelConstraints = getChannelConstraints(request.channel, request.type);

  const prompts: Record<string, string> = {
    email_subject: `${productBlock}

Generate 5 email subject lines that would make the target audience OPEN the email.

Each subject line should:
- Lead with a specific pain point, curiosity gap, or desired outcome
- Feel personal, not promotional
- Be under 50 characters when possible

Return exactly 5 subject lines, one per line, numbered 1-5. No other text.`,

    email_body: `${productBlock}

Write an email body that converts.

Structure:
1. Opening: Acknowledge a specific frustration or aspiration the reader has
2. Agitate: Make them feel the cost of NOT solving this problem
3. Solution: Introduce how ${request.productName || 'the product'} addresses this — be specific
4. Proof/specificity: Include a concrete detail (number, timeframe, outcome)
5. CTA: One clear next step

Write in HTML format. Under 200 words. Tone: ${request.tone || 'Professional'}.`,

    social_post: `${productBlock}

${channelConstraints}

Write ONE short post. Pick a SPECIFIC pain point or desire the target audience has and build the post around it.

CRITICAL LENGTH RULES:
- This is a SHORT POST. Brevity is everything.
- 1-2 sentences MAXIMUM. If you can say it in one sentence, do it in one sentence.
- Every word must earn its place. Cut ruthlessly.
- Do NOT write paragraphs, lists, or multi-line posts.
- Think tweet-length, not blog-post-length.

Do NOT write a generic product announcement. Write something that makes the reader think "this is exactly what I'm dealing with."

Return ONLY the post text. No labels, no "here's the post", no quotation marks wrapping the output. No hashtags inline — if needed, put them on a separate line after the caption.`,

    ad_copy: `${productBlock}

${channelConstraints}

Write ad copy that stops the scroll and drives clicks.

The headline should call out the audience or their problem — NOT the product name.
The primary text should agitate the pain point, then present the product as the fix.

Provide as JSON:
{
  "headline": "under 40 chars — pain point or desired outcome",
  "primaryText": "under 125 chars — agitate problem → product solution",
  "description": "under 30 chars — CTA or benefit"
}`,

    full_campaign: `${productBlock}

Create a multi-channel campaign. Pick ONE specific pain point or angle and make it the thread across all channels.

The pain point: identify the single most urgent frustration or desire the target audience has that this product solves. Every piece of content below should riff on this same angle.

1. Campaign name (2-4 words, punchy)
2. The angle (1 sentence: what pain point are we hitting?)
3. Email subject line (under 50 chars, curiosity-driven)
4. Email body (HTML, under 200 words, pain → agitate → solve → CTA)
5. X/Twitter post (under 280 chars)
6. Facebook/Instagram post (3-5 sentences)
7. CTA (the one action we want people to take)

Format each section with a clear header.`,
  };

  const userPrompt = prompts[request.type] || prompts.social_post;

  let systemPrompt = SYSTEM_PROMPT;
  if (request.brandVoice) {
    systemPrompt += buildBrandVoiceBlock(request.brandVoice);
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const text = response.choices[0]?.message?.content || '';

  return { content: text };
}
