import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { routing } from '@/i18n/routing';

export const runtime = 'nodejs';

const updateLocaleSchema = z.object({
  locale: z.enum(routing.locales),
});

/**
 * PUT /api/settings/locale — set the caller's UI language preference.
 *
 * Stored on every `workspaces/*\/members/{uid}` doc the user belongs to
 * (there is no top-level `users/{uid}` collection) so a preference set in
 * one workspace is honored no matter which workspace the app layout
 * happens to resolve locale from on the next request.
 */
export async function PUT(req: Request) {
  try {
    const ctx = await requireContext(req);
    const { locale } = updateLocaleSchema.parse(await req.json());

    const memberDocs = await adminDb.collectionGroup('members').where('uid', '==', ctx.uid).get();
    const batch = adminDb.batch();
    for (const doc of memberDocs.docs) {
      batch.set(doc.ref, { locale }, { merge: true });
    }
    await batch.commit();

    return apiOk({ locale });
  } catch (error) {
    return apiError(error);
  }
}
