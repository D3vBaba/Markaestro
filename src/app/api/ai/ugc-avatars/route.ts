import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { listAvatars } from '@/lib/ai/creatify-client';

export async function GET(req: Request) {
  try {
    await requireContext(req);
    const url = new URL(req.url);
    const gender = url.searchParams.get('gender') || undefined;
    const style = url.searchParams.get('style') || undefined;

    const avatars = await listAvatars({ gender, style });

    // Return only active avatars with preview images, limit to 20
    const filtered = avatars
      .filter((a) => a.is_active && a.preview_image_9x16)
      .slice(0, 20)
      .map((a) => ({
        id: a.id,
        name: a.creator_name,
        gender: a.gender,
        ageRange: a.age_range,
        style: a.style,
        scene: a.video_scene,
        previewImage: a.preview_image_9x16,
        previewVideo: a.preview_video_9x16,
      }));

    return apiOk({ avatars: filtered });
  } catch (error) {
    return apiError(error);
  }
}
