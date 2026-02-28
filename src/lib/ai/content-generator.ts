import OpenAI from 'openai';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

export type ContentRequest = {
  type: 'email_subject' | 'email_body' | 'social_post' | 'ad_copy' | 'full_campaign';
  productName?: string;
  productDescription?: string;
  targetAudience?: string;
  channel?: string;
  tone?: string;
  additionalContext?: string;
};

export type ContentResponse = {
  content: string;
  suggestions?: string[];
};

const SYSTEM_PROMPT = `You are a world-class marketing copywriter working for Markaestro, a premium marketing automation platform. You create high-converting, engaging content that drives action.

Rules:
- Be concise and action-oriented
- Use clear, compelling language
- Focus on benefits over features
- Include a clear call-to-action when appropriate
- Match the tone requested (professional, casual, urgent, etc.)
- Never use clickbait or misleading claims`;

export async function generateContent(request: ContentRequest): Promise<ContentResponse> {
  const client = getClient();

  const prompts: Record<string, string> = {
    email_subject: `Generate 5 compelling email subject lines for:
Product: ${request.productName || 'N/A'}
Description: ${request.productDescription || 'N/A'}
Target Audience: ${request.targetAudience || 'General'}
Tone: ${request.tone || 'Professional'}
${request.additionalContext ? `Context: ${request.additionalContext}` : ''}

Return exactly 5 subject lines, one per line, numbered 1-5. No other text.`,

    email_body: `Write a compelling email body for:
Product: ${request.productName || 'N/A'}
Description: ${request.productDescription || 'N/A'}
Target Audience: ${request.targetAudience || 'General'}
Tone: ${request.tone || 'Professional'}
${request.additionalContext ? `Context: ${request.additionalContext}` : ''}

Write the email body in HTML format. Keep it concise (under 200 words). Include a clear CTA.`,

    social_post: `Write a ${request.channel || 'social media'} post for:
Product: ${request.productName || 'N/A'}
Description: ${request.productDescription || 'N/A'}
Target Audience: ${request.targetAudience || 'General'}
Tone: ${request.tone || 'Casual'}
${request.additionalContext ? `Context: ${request.additionalContext}` : ''}

${request.channel === 'x' ? 'Keep it under 280 characters.' : 'Keep it engaging and shareable.'}`,

    ad_copy: `Write ad copy for:
Product: ${request.productName || 'N/A'}
Description: ${request.productDescription || 'N/A'}
Target Audience: ${request.targetAudience || 'General'}
Channel: ${request.channel || 'Facebook'}
Tone: ${request.tone || 'Professional'}
${request.additionalContext ? `Context: ${request.additionalContext}` : ''}

Provide: headline (under 40 chars), primary text (under 125 chars), and description (under 30 chars). Format as JSON with keys: headline, primaryText, description.`,

    full_campaign: `Create a complete multi-channel campaign brief for:
Product: ${request.productName || 'N/A'}
Description: ${request.productDescription || 'N/A'}
Target Audience: ${request.targetAudience || 'General'}
Tone: ${request.tone || 'Professional'}
${request.additionalContext ? `Context: ${request.additionalContext}` : ''}

Include:
1. Campaign name suggestion
2. Email subject line
3. Email body (HTML, under 200 words)
4. X/Twitter post (under 280 chars)
5. Facebook/Instagram post
6. Key CTA

Format each section with a clear header.`,
  };

  const userPrompt = prompts[request.type] || prompts.email_subject;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const text = response.choices[0]?.message?.content || '';

  return { content: text };
}
