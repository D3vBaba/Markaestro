/**
 * Firestore list-query helpers with stable server ordering and opaque cursors.
 *
 * The steady-state path orders in Firestore. During an index rollout, a
 * compatibility fallback sorts the complete matching set before applying the
 * limit, preserving correctness instead of returning an arbitrary subset.
 */

import { FieldPath, type CollectionReference, type Query, type WhereFilterOp } from 'firebase-admin/firestore';

export type FieldFilter = {
  field: string;
  op: WhereFilterOp;
  value: unknown;
};

export type ListQueryOptions = {
  filters?: FieldFilter[];
  orderByField?: string;
  orderByDirection?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
};

type CursorPayload = { id: string; value: unknown };

export type ListQueryPage<T extends Record<string, unknown>> = {
  items: Array<{ id: string } & T>;
  nextCursor: string | null;
};

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
    if (typeof parsed.id !== 'string' || !parsed.id) throw new Error('invalid');
    return parsed;
  } catch {
    throw new Error('VALIDATION_INVALID_CURSOR');
  }
}

function isMissingIndexError(error: unknown): boolean {
  const candidate = error as { code?: number | string; message?: string };
  return candidate?.code === 9 ||
    candidate?.code === 'failed-precondition' ||
    String(candidate?.message || error).includes('FAILED_PRECONDITION');
}

function compareValues(a: unknown, b: unknown): number {
  const av = a == null ? '' : String(a);
  const bv = b == null ? '' : String(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function compareItems(
  a: { id: string } & Record<string, unknown>,
  b: { id: string } & Record<string, unknown>,
  field: string | undefined,
  direction: 'asc' | 'desc',
): number {
  const dir = direction === 'desc' ? -1 : 1;
  const fieldComparison = field ? compareValues(a[field], b[field]) : 0;
  if (fieldComparison !== 0) return fieldComparison * dir;
  return a.id.localeCompare(b.id) * dir;
}

function applyFilters(query: Query, filters: FieldFilter[]): Query {
  let next = query;
  for (const filter of filters) next = next.where(filter.field, filter.op, filter.value);
  return next;
}

export async function executeListQueryPage<T extends Record<string, unknown>>(
  collection: CollectionReference | Query,
  options: ListQueryOptions = {},
): Promise<ListQueryPage<T>> {
  const { filters = [], orderByField, orderByDirection = 'desc', limit = 50 } = options;
  const cursor = decodeCursor(options.cursor);
  let query = applyFilters(collection as Query, filters);
  if (orderByField) query = query.orderBy(orderByField, orderByDirection);
  query = query.orderBy(FieldPath.documentId(), orderByDirection);
  if (cursor) {
    query = orderByField ? query.startAfter(cursor.value, cursor.id) : query.startAfter(cursor.id);
  }

  try {
    const snapshot = await query.limit(limit + 1).get();
    const hasMore = snapshot.docs.length > limit;
    const items = snapshot.docs.slice(0, limit).map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }) as { id: string } & T);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? encodeCursor({ id: last.id, value: orderByField ? last[orderByField] ?? null : null })
        : null,
    };
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    const fallbackSnapshot = await applyFilters(collection as Query, filters).get();
    let items = fallbackSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }) as { id: string } & T);
    items.sort((a, b) => compareItems(a, b, orderByField, orderByDirection));
    if (cursor) {
      const marker = { id: cursor.id, ...(orderByField ? { [orderByField]: cursor.value } : {}) };
      items = items.filter((item) => compareItems(item, marker, orderByField, orderByDirection) > 0);
    }
    const hasMore = items.length > limit;
    items = items.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? encodeCursor({ id: last.id, value: orderByField ? last[orderByField] ?? null : null })
        : null,
    };
  }
}

export async function executeListQuery<T extends Record<string, unknown>>(
  collection: CollectionReference | Query,
  options: ListQueryOptions = {},
): Promise<Array<{ id: string } & T>> {
  return (await executeListQueryPage<T>(collection, options)).items;
}
