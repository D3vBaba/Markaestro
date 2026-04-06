/**
 * Cursor-based pagination helper for Firestore collection sweeps.
 * Replaces hard-capped .limit(N) queries that silently drop documents.
 */

import { adminDb } from '@/lib/firebase-admin';

const PAGE_SIZE = 200;

/**
 * Iterate through ALL documents in a collection, yielding pages.
 * Uses orderBy(__name__) + startAfter for cursor-based pagination.
 */
export async function getAllDocs(
  collectionPath: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = adminDb.collection(collectionPath).orderBy('__name__').limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    const snap = await query.get();
    if (snap.empty) break;
    docs.push(...snap.docs);
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  return docs;
}

/**
 * Iterate through ALL documents matching a query, yielding pages.
 * Caller provides the base query (with where clauses); this adds pagination.
 */
export async function getAllMatchingDocs(
  baseQuery: FirebaseFirestore.Query,
  pageSize = PAGE_SIZE,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = baseQuery.limit(pageSize);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    const snap = await query.get();
    if (snap.empty) break;
    docs.push(...snap.docs);
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  return docs;
}
