import OpenAI from 'openai';
import type { BrandVoice } from '@/lib/schemas';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

export type ContentRequest = {
  type: 'social_post' | 'ad_copy' | 'full_campaign';
  productName?: string;
  productDescription?: string;
  /** Product categories like saas, mobile, fashion, etc. */
  productCategories?: string[];
  targetAudience?: string;
  channel?: string;
  tone?: string;
  additionalContext?: string;
  brandVoice?: BrandVoice;
  /** Grounded market research context from Serper — injected into the prompt */
  researchContext?: string;
};

export type ContentResponse = {
  content: string;
  suggestions?: string[];
};

export const SYSTEM_PROMPT = `You are an elite social media copywriter who writes content that stops the scroll, sparks emotion, and drives action. You blend direct-response persuasion with the raw authenticity that dominates modern social media.

YOUR CORE PHILOSOPHY:
Every post must do THREE things: (1) make the reader feel something, (2) make them see themselves in the content, and (3) give them a clear reason to act. If your post doesn't hit all three, rewrite it.

YOUR CREATIVE ARSENAL — rotate through these hooks unpredictably:
• THE COLD OPEN: Drop the reader into a vivid micro-story mid-scene. "You're staring at your screen at 11pm, refreshing the same report for the third time—"
• THE PATTERN INTERRUPT: Say something counterintuitive that makes them pause. "Stop trying to be productive." Then flip it.
• THE INSIDER SECRET: Make the reader feel like they're getting exclusive knowledge. "Most people don't know this, but..."
• THE IDENTITY HOOK: Call out who they ARE, not just what they want. "If you're the person your team calls when everything's on fire—"
• THE EMOTIONAL MIRROR: Name the feeling they can't articulate. "That knot in your stomach when you hit send and realize—"
• THE BOLD CLAIM: Lead with a specific, surprising result. "247 hours. That's what we gave back to our users last month."
• THE QUESTION THAT HAUNTS: Ask something they can't scroll past. "When was the last time you actually enjoyed this part of your job?"
• THE SOCIAL PROOF DROP: Lead with real outcomes. "She switched three weeks ago. Her team noticed on day two."
• THE CONFESSION: Vulnerability that builds trust. "We almost built this feature wrong. Here's what saved us—"
• THE FUTURE PAINT: Show them a vivid picture of their life after. "Imagine opening your laptop Monday morning and everything is just... done."

CTA RULES — every post MUST end with a clear call to action:
• Make the CTA feel like a natural next step, never forced
• Be specific: "Try the free plan" beats "Check it out", "DM us 'SCALE'" beats "Reach out"
• Use action verbs: Start, Try, Grab, Join, Discover, Build, Unlock, Switch
• Create low-friction entry: free trials, quick wins, simple first steps
• When appropriate, add urgency: limited time, limited spots, seasonal relevance
• Match CTA energy to the post — casual posts get casual CTAs, bold posts get bold CTAs
• Vary CTA format: questions ("Ready to stop guessing?"), commands ("Start today."), invitations ("Join 10,000+ teams who already did.")

WRITING RULES:
- Never start with the product name. Start with the reader's world.
- Use "you" language. Talk TO the reader, not ABOUT the product.
- One idea per post. Go deep on one angle, don't scatter.
- Be ruthlessly specific. Numbers, names, scenarios > vague claims. "Cut your reporting time from 4 hours to 20 minutes" destroys "Save time on reports."
- Show, don't tell. Paint scenes. Use sensory language. Make them FEEL the before and the after.
- KILL these words on sight: "excited to announce", "we're thrilled", "check out our amazing", "game-changer", "revolutionary", "seamlessly", "leverage", "elevate", "unlock your potential"
- Sound like a sharp, witty friend who happens to know about this product — not a brand account.
- Every sentence must earn its place. If it doesn't make the reader feel, think, or act — delete it.
- End with a CTA. Always. No exceptions.`;

export function buildBrandVoiceBlock(bv: BrandVoice): string {
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
export function getChannelConstraints(channel?: string, contentType?: string): string {
  const isShort = contentType === 'social_post';

  switch (channel) {
    case 'facebook':
      return [
        isShort
          ? 'FORMAT: Facebook post. AIM for 40-80 characters (posts this length get 66% higher engagement). Max 2 sentences + CTA.'
          : 'FORMAT: Facebook post. Keep it under 3 short sentences + CTA.',
        'Style: direct, conversational, emotionally charged. Facebook users share what makes them FEEL something.',
        'Structure: Hook (pain/desire/story) → Bridge (product connection) → CTA (specific action or question that drives comments).',
        'ENGAGEMENT TACTICS: Questions drive 100% more comments. Controversial takes get shares. Relatable pain points get "this is so me" reactions.',
        'CTA examples: "Drop a 🔥 if you\'ve been there" / "Tag someone who needs this" / "Try it free → link in comments" / "Which one are you? Comment below"',
      ].join('\n');
    case 'instagram':
      return [
        isShort
          ? 'FORMAT: Instagram caption. AIM for 125-150 characters (the sweet spot for engagement). 1-2 sentences max + CTA.'
          : 'FORMAT: Instagram caption. Keep the first line under 125 characters (that\'s what shows before "more"). End with CTA.',
        'Style: aspirational but raw. The polished-but-real aesthetic that earns saves. Write like someone who\'s genuinely passionate, not a brand.',
        'Structure: Scroll-stopping first line → emotional or educational value → clear CTA.',
        'ENGAGEMENT TACTICS: "Save this for later" drives saves (the #1 signal). Carousel-style hooks ("3 things I wish I knew...") drive engagement.',
        'CTA examples: "Save this 📌" / "Link in bio" / "Double tap if you agree" / "Share with someone who needs this"',
        'Hashtags: 3-5 niche-relevant ones AFTER the caption, separated by a line break. Mix popular + specific.',
      ].join('\n');
    case 'tiktok':
      return [
        isShort
          ? 'FORMAT: TikTok caption. AIM for under 100 characters. One punchy sentence + CTA.'
          : 'FORMAT: TikTok caption. Keep it under 150 characters + CTA.',
        'Style: unhinged-but-smart. TikTok rewards personality, hot takes, and raw honesty. Write like you\'re texting your sharpest friend.',
        'Structure: Bold claim or question → implied CTA or curiosity gap.',
        'ENGAGEMENT TACTICS: "POV:" hooks, "Nobody talks about..." hooks, "The X that changed my Y" hooks. Controversy and specificity win.',
        'CTA examples: "Follow for more" / "Comment LINK" / "Stitch this with your take" / "Part 2?"',
        'Hashtags: 2-3 niche-relevant ones.',
      ].join('\n');
    case 'linkedin':
      return [
        isShort
          ? 'FORMAT: LinkedIn post. AIM for 150-300 characters for the core hook + CTA (short posts can still perform if insight-dense). 1-2 tight paragraphs max.'
          : 'FORMAT: LinkedIn post. Lead with a sharp professional insight; keep scannable lines.',
        'Style: credible, specific, and conversational-professional. Avoid buzzword soup; use concrete outcomes and lessons.',
        'Structure: Hook (contrarian insight or lived lesson) → supporting line → clear CTA (comment, DM, link).',
        'ENGAGEMENT TACTICS: Ask one focused question. Share a number or a before/after. Invite disagreement respectfully.',
        'CTA examples: "Agree or disagree in the comments" / "DM me [topic]" / "Link in comments" / "What would you add?"',
      ].join('\n');
    default:
      return isShort
        ? 'FORMAT: Social media post. Keep it under 150 characters — 1-2 sentences max. End with a clear CTA.'
        : 'FORMAT: Social media post. Keep it concise and engaging. Always end with a CTA.';
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
  const context = request.additionalContext || '';

  const research = request.researchContext || '';

  const prompts: Record<string, string> = {
    social_post: `${productBlock}

${research ? `${research}\n` : ''}${channelConstraints}

${context ? `IMPORTANT — USER DIRECTION:
The user has provided specific direction for this post. You MUST follow their guidance closely. Their direction takes priority over default pain-point or angle selection. Build the post around what they asked for:
"${context}"
` : 'Write ONE short post. Pick a SPECIFIC pain point, desire, or surprising truth about the target audience and build the post around it. Choose a creative hook from your arsenal — do NOT default to the same pattern every time. Use any relevant trend or news hook from the market research above if it fits naturally.'}

CRITICAL RULES:
- SHORT POST: 1-2 sentences + CTA. Brevity is everything.
- Every word must earn its place. Cut ruthlessly.
- Do NOT write paragraphs, lists, or multi-line posts.
- MUST include a clear, specific CTA at the end. Not "check us out" — something actionable and compelling.
- The CTA should feel like the natural next step after reading the post.
- Make the reader FEEL something: curiosity, recognition, urgency, relief, or aspiration.
- Do NOT write a generic product announcement or boring corporate speak.
- Write something that makes the reader think "this is exactly what I'm dealing with" or "I need to know more."

Return ONLY the post text. No labels, no "here's the post", no quotation marks wrapping the output. No hashtags inline — if needed, put them on a separate line after the caption.`,

    ad_copy: `${productBlock}

${research ? `${research}\n` : ''}${channelConstraints}

${context ? `IMPORTANT — USER DIRECTION:
The user has provided specific direction. Follow their guidance closely — it takes priority over default angle selection:
"${context}"
` : ''}Write ad copy that stops the scroll and drives clicks.

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

${context ? `IMPORTANT — USER DIRECTION:
The user has provided specific direction for this campaign. Use their guidance as the foundation for the angle and messaging across all channels:
"${context}"
` : 'The pain point: identify the single most urgent frustration or desire the target audience has that this product solves.'} Every piece of content below should riff on this same angle.

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
