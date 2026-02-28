import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { generateContent, type ContentRequest } from '@/lib/ai/content-generator';
import { z } from 'zod';

const generateSchema = z.object({
  type: z.enum(['email_subject', 'email_body', 'social_post', 'ad_copy', 'full_campaign']),
  productName: z.string().trim().max(200).optional(),
  productDescription: z.string().trim().max(2000).optional(),
  targetAudience: z.string().trim().max(500).optional(),
  channel: z.string().trim().max(50).optional(),
  tone: z.string().trim().max(50).optional(),
  additionalContext: z.string().trim().max(2000).optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const data = generateSchema.parse(body);

    const result = await generateContent(data as ContentRequest);
    return apiOk({ ...result, generatedBy: 'openai', requestedBy: ctx.uid });
  } catch (error) {
    return apiError(error);
  }
}
