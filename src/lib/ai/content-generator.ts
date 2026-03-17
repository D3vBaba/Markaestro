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

function getChannelConstraints(channel?: string): string {
  switch (channel) {
    case 'x':
      return [
        'FORMAT: X/Twitter post. MUST be under 280 characters total.',
        'Style: punchy, conversational, opinion-driven. X rewards hot takes and relatable moments.',
        'Structure: Hook line → insight or pain point → product tie-in or CTA.',
        'Use line breaks for readability. Hashtags optional (1-2 max, only if natural).',
      ].join('\n');
    case 'facebook':
      return [
        'FORMAT: Facebook post. 1-3 short paragraphs.',
        'Style: conversational and relatable. Facebook rewards storytelling and emotion.',
        'Structure: Strong opening line that hooks → story/pain point → how the product helps → CTA.',
        'Use line breaks between paragraphs. Emojis sparingly if they fit the brand voice.',
      ].join('\n');
    case 'instagram':
      return [
        'FORMAT: Instagram caption. Medium length — 3-6 sentences.',
        'Style: visual, aspirational but authentic. Instagram rewards vulnerability and value.',
        'Structure: Scroll-stopping first line → expand on the idea → product connection → CTA.',
        'Put the hook in the first line (only ~125 chars show before "more"). Hashtags: 3-5 relevant ones at the end.',
      ].join('\n');
    case 'tiktok':
      return [
        'FORMAT: TikTok caption. Short and punchy — 1-2 sentences max.',
        'Style: casual, authentic, trend-aware. TikTok rewards raw honesty and humor.',
        'Structure: One bold statement or question → product mention. Keep it under 150 chars ideally.',
        'Hashtags: 2-3 trending or niche-relevant ones.',
      ].join('\n');
    default:
      return 'FORMAT: Social media post. Keep it concise and engaging.';
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
  const channelConstraints = getChannelConstraints(request.channel);

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

Write ONE post. Pick a SPECIFIC pain point or desire the target audience has and build the post around it.

Do NOT write a generic product announcement. Write something that makes the reader think "this is exactly what I'm dealing with."

Return ONLY the post text. No labels, no "here's the post", no quotation marks wrapping the output.`,

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
