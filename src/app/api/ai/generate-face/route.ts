import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { generateFaceAvatar } from '@/lib/ai/image-generator';
import { z } from 'zod';

const faceSchema = z.object({
  name: z.string().trim().min(1).max(100).default('AI Creator'),
  gender: z.enum(['male', 'female']).optional(),
  ageRange: z.enum(['young adult', 'adult', 'middle aged']).optional(),
  ethnicity: z.string().trim().max(50).optional(),
  style: z.string().trim().max(200).optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const data = faceSchema.parse(body);

    const { imageUrl } = await generateFaceAvatar(ctx.workspaceId, {
      gender: data.gender,
      ageRange: data.ageRange,
      ethnicity: data.ethnicity,
      style: data.style,
    });

    // Save as a reusable avatar
    const col = adminDb.collection(`workspaces/${ctx.workspaceId}/ugcAvatars`);
    const docRef = col.doc();
    const avatarData = {
      name: data.name,
      imageUrl,
      generated: true,
      createdAt: new Date().toISOString(),
      createdBy: ctx.uid,
    };
    await docRef.set(avatarData);

    return apiOk({ id: docRef.id, ...avatarData });
  } catch (error) {
    return apiError(error);
  }
}
