import { adminDb } from '@/lib/firebase-admin';
import type { ResearchBrief } from '@/lib/schemas';

const CACHE_COLLECTION = 'researchCache';
const CACHE_TTL_HOURS = 24;

function buildCacheKey(productId: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${productId}_${date}`;
}

interface CacheEntry {
  productId: string;
  cacheKey: string;
  research: ResearchBrief;
  createdAt: string;
  expiresAt: string;
}

export async function getResearchCache(productId: string): Promise<ResearchBrief | null> {
  try {
    const cacheKey = buildCacheKey(productId);
    const doc = await adminDb.collection(CACHE_COLLECTION).doc(cacheKey).get();

    if (!doc.exists) return null;

    const entry = doc.data() as CacheEntry;
    const now = new Date();
    const expiresAt = new Date(entry.expiresAt);

    if (now > expiresAt) {
      // Expired — delete async, don't block
      doc.ref.delete().catch(() => {});
      return null;
    }

    return entry.research;
  } catch {
    // Cache miss on any error — degrade gracefully
    return null;
  }
}

export async function setResearchCache(
  productId: string,
  research: ResearchBrief,
): Promise<void> {
  try {
    const cacheKey = buildCacheKey(productId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000);

    const entry: CacheEntry = {
      productId,
      cacheKey,
      research,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await adminDb.collection(CACHE_COLLECTION).doc(cacheKey).set(entry);
  } catch {
    // Cache write failure is non-fatal
  }
}
