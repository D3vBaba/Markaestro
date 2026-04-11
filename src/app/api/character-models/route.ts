import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { listActiveCharacterModels } from '@/lib/character-models/firestore';

export async function GET(req: Request) {
  try {
    await requireContext(req);
    const models = await listActiveCharacterModels();
    return apiOk({ models });
  } catch (error) {
    return apiError(error);
  }
}
