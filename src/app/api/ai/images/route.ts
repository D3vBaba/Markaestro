import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();

    const prefix = `workspaces/${ctx.workspaceId}/generated/`;
    const [files] = await bucket.getFiles({ prefix });

    const images = files
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f.name))
      .map((f) => ({
        name: f.name.replace(prefix, ''),
        url: `https://storage.googleapis.com/${bucket.name}/${f.name}`,
        createdAt: String(f.metadata.timeCreated || f.metadata.updated || ''),
        size: Number(f.metadata.size || 0),
        contentType: f.metadata.contentType,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return apiOk({ images });
  } catch (error) {
    return apiError(error);
  }
}
