/**
 * Firestore helpers for the character models global collection.
 *
 * Collection layout:
 *   characterModels/{modelId}
 *
 * Character models are workspace-agnostic — shared across all users.
 * Only admins/seed scripts write them; all users can read them.
 */
import { adminDb } from '@/lib/firebase-admin';
import type { CharacterModel } from '@/lib/schemas';

export function characterModelsCollection() {
  return adminDb.collection('characterModels');
}

export function characterModelDoc(modelId: string) {
  return characterModelsCollection().doc(modelId);
}

export async function listActiveCharacterModels(): Promise<CharacterModel[]> {
  const snap = await characterModelsCollection()
    .where('isActive', '==', true)
    .get();

  const models = snap.docs.map((doc) => doc.data() as CharacterModel);
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCharacterModel(modelId: string): Promise<CharacterModel | null> {
  const snap = await characterModelDoc(modelId).get();
  if (!snap.exists) return null;
  return snap.data() as CharacterModel;
}
