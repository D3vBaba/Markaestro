/**
 * Safe Firestore list query builder.
 *
 * The problem this solves:
 *   .orderBy(fieldA) + .where(fieldB == v)  →  requires composite index [fieldB, fieldA]
 *
 * The safe rule:
 *   When equality/range filters are present, skip .orderBy() and sort in JS.
 *   When no filters, .orderBy() is safe (uses a single-field auto-index).
 *
 * Use this helper for any API route that accepts optional query-param filters.
 * For queries with hardcoded unconditional filters + orderBy (background jobs,
 * publishers), declare a composite index in firestore.indexes.json instead.
 */

import type { CollectionReference, Query, WhereFilterOp } from 'firebase-admin/firestore';

export type FieldFilter = {
  field: string;
  op: WhereFilterOp;
  value: unknown;
};

export type ListQueryOptions = {
  /** Equality or range filters. When any are present, orderBy is skipped. */
  filters?: FieldFilter[];
  /** Field to sort by. Applied via Firestore when no filters; applied in JS otherwise. */
  orderByField?: string;
  /** Default: 'desc' */
  orderByDirection?: 'asc' | 'desc';
  limit?: number;
};

/**
 * Executes a Firestore list query without triggering composite-index errors.
 *
 * Always returns results sorted by `orderByField` (Firestore or JS depending on
 * whether filters are present).
 */
export async function executeListQuery<T extends Record<string, unknown>>(
  collection: CollectionReference | Query,
  options: ListQueryOptions = {},
): Promise<Array<{ id: string } & T>> {
  const { filters = [], orderByField, orderByDirection = 'desc', limit } = options;

  let query: Query = collection as Query;

  for (const f of filters) {
    query = query.where(f.field, f.op, f.value);
  }

  // Only apply .orderBy() when there are no filters — single-field auto-index is sufficient.
  // When filters are present we skip .orderBy() here and sort in JS below.
  if (filters.length === 0 && orderByField) {
    query = query.orderBy(orderByField, orderByDirection);
  }

  if (limit !== undefined) {
    query = query.limit(limit);
  }

  const snapshot = await query.get();
  const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as { id: string } & T);

  if (orderByField) {
    const dir = orderByDirection === 'desc' ? -1 : 1;
    docs.sort((a, b) => {
      const av = String(a[orderByField] ?? '');
      const bv = String(b[orderByField] ?? '');
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }

  return docs;
}
