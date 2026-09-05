/**
 * Shared scaffolding for API route tests.
 *
 * 106 test files cover the library layer well, and only 14 route files had a
 * test. The reason is visible in those 14: each builds its own Firestore
 * double, its own auth mocks, and its own request construction, forty lines
 * before the first assertion. That cost is why the routes this audit found
 * bugs in (`posts/[id]`, `posts/[id]/publish`, `media/upload`, the
 * intelligence routes) had no tests at all.
 *
 * This makes a route test roughly ten lines, and removes the reason not to
 * write one.
 *
 * `vi.mock` is hoisted and module-scoped, so a harness cannot install the
 * mocks for you; what it can do is give you the doubles to install and the
 * request plumbing around them. The intended shape:
 *
 *     const db = createFirestoreStub();
 *     vi.mock('@/lib/firebase-admin', () => ({ adminDb: db.adminDb }));
 *     vi.mock('@/lib/server-auth', () => ({ requireContext: async () => mockContext() }));
 *
 *     const res = await callRoute(POST, { body: { ... } });
 *     expect(res.status).toBe(201);
 */

import type { WorkspaceRole } from '@/lib/schemas';

export type MockRequestContext = {
  uid: string;
  email: string;
  workspaceId: string;
  role: WorkspaceRole;
  emailVerified: boolean;
};

/**
 * A signed-in owner, which is the case most routes are written for. Override
 * `role` to test the role matrix; override `workspaceId` to test isolation.
 */
export function mockContext(overrides: Partial<MockRequestContext> = {}): MockRequestContext {
  return {
    uid: 'user_1',
    email: 'owner@example.com',
    workspaceId: 'ws_1',
    role: 'owner',
    emailVerified: true,
    ...overrides,
  };
}

export type CallRouteOptions = {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Dynamic segment values, e.g. `{ id: 'post_1' }`. */
  params?: Record<string, string>;
  /** Query string values, appended to `url`. */
  query?: Record<string, string | number | undefined>;
};

export type RouteResult<T = Record<string, unknown>> = {
  status: number;
  body: T;
  headers: Headers;
};

/**
 * Generic over the params shape so a handler declaring
 * `{ params: Promise<{ id: string }> }` still assigns. A handler's own param
 * type is more specific than `Record<string, string>`, and TypeScript checks
 * that position contravariantly, so a single concrete signature here would
 * reject every dynamic route.
 */
type RouteHandler<P extends Record<string, string> = Record<string, string>> = (
  req: Request,
  context: { params: Promise<P> },
) => Promise<Response> | Response;

/**
 * Call a route handler and read its response.
 *
 * Parses the body defensively rather than with a bare `await res.json()`: a
 * route that answers with HTML or an empty body is exactly the failure a route
 * test is there to catch, and a `SyntaxError` thrown from the harness would
 * hide it behind a stack trace from the wrong file.
 */
export async function callRoute<
  T = Record<string, unknown>,
  P extends Record<string, string> = Record<string, string>,
>(
  handler: RouteHandler<P>,
  options: CallRouteOptions = {},
): Promise<RouteResult<T>> {
  const base = options.url ?? 'http://localhost/api/test';
  const url = new URL(base);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const request = new Request(url.toString(), {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const response = await handler(request, {
    params: Promise.resolve((options.params ?? {}) as P),
  });

  const text = await response.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    body = { error: 'NON_JSON_RESPONSE', raw: text } as unknown as T;
  }

  return { status: response.status, body, headers: response.headers };
}

// ── Firestore double ────────────────────────────────────────────────────────

type Doc = Record<string, unknown>;

/**
 * An in-memory Firestore stand-in covering the operations routes actually use:
 * `doc().get/set/update/delete`, `collection().doc()`, and the
 * `where/orderBy/limit/get` chain.
 *
 * Deliberately not a full emulator. It exists so a route test can say "this
 * document exists, with this data" in one line and then assert what the route
 * wrote, which is the shape of nearly every route test worth having. Anything
 * needing real query semantics belongs in `validate:queries` against real
 * Firestore, which is where that question is actually answered.
 */
export function createFirestoreStub(seed: Record<string, Doc> = {}) {
  const docs = new Map<string, Doc>(Object.entries(seed));
  const writes: Array<{ op: 'set' | 'update' | 'delete'; path: string; data?: Doc }> = [];

  function snapshot(path: string) {
    const data = docs.get(path);
    return {
      id: path.split('/').pop() ?? '',
      exists: data !== undefined,
      ref: docRef(path),
      data: () => (data === undefined ? undefined : { ...data }),
      get: (field: string) => data?.[field],
    };
  }

  function docRef(path: string) {
    return {
      id: path.split('/').pop() ?? '',
      path,
      get: async () => snapshot(path),
      set: async (data: Doc, options?: { merge?: boolean }) => {
        const next = options?.merge ? { ...(docs.get(path) ?? {}), ...data } : { ...data };
        docs.set(path, next);
        writes.push({ op: 'set', path, data });
      },
      update: async (data: Doc) => {
        if (!docs.has(path)) throw new Error('NOT_FOUND');
        docs.set(path, { ...docs.get(path), ...data });
        writes.push({ op: 'update', path, data });
      },
      delete: async () => {
        docs.delete(path);
        writes.push({ op: 'delete', path });
      },
      collection: (name: string) => collectionRef(`${path}/${name}`),
    };
  }

  function collectionRef(path: string) {
    const filters: Array<{ field: string; op: string; value: unknown }> = [];
    let limitValue: number | null = null;

    const query = {
      where(field: string, op: string, value: unknown) {
        filters.push({ field, op, value });
        return query;
      },
      orderBy() {
        return query;
      },
      limit(value: number) {
        limitValue = value;
        return query;
      },
      startAfter() {
        return query;
      },
      async count() {
        const matched = await query.get();
        return { data: () => ({ count: matched.docs.length }) };
      },
      async get() {
        let matched = [...docs.entries()]
          .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .map(([key]) => snapshot(key));

        for (const filter of filters) {
          matched = matched.filter((entry) => {
            const value = (entry.data() ?? {})[filter.field];
            if (filter.op === '==') return value === filter.value;
            if (filter.op === 'in') return Array.isArray(filter.value) && filter.value.includes(value);
            if (filter.op === 'array-contains') {
              return Array.isArray(value) && value.includes(filter.value);
            }
            if (filter.op === '<=') return String(value) <= String(filter.value);
            if (filter.op === '>=') return String(value) >= String(filter.value);
            return true;
          });
        }

        if (limitValue !== null) matched = matched.slice(0, limitValue);
        return { docs: matched, empty: matched.length === 0, size: matched.length };
      },
      doc: (id?: string) => docRef(`${path}/${id ?? `generated_${docs.size + 1}`}`),
    };

    return query;
  }

  const adminDb = {
    doc: (path: string) => docRef(path),
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
    collection: (path: string) => collectionRef(path),
    batch: () => {
      const staged: Array<() => void> = [];
      return {
        set: (ref: { path: string }, data: Doc, options?: { merge?: boolean }) => {
          staged.push(() => {
            const next = options?.merge ? { ...(docs.get(ref.path) ?? {}), ...data } : { ...data };
            docs.set(ref.path, next);
            writes.push({ op: 'set', path: ref.path, data });
          });
        },
        create: (ref: { path: string }, data: Doc) => {
          staged.push(() => {
            docs.set(ref.path, { ...data });
            writes.push({ op: 'set', path: ref.path, data });
          });
        },
        update: (ref: { path: string }, data: Doc) => {
          staged.push(() => {
            docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data });
            writes.push({ op: 'update', path: ref.path, data });
          });
        },
        delete: (ref: { path: string }) => {
          staged.push(() => {
            docs.delete(ref.path);
            writes.push({ op: 'delete', path: ref.path });
          });
        },
        commit: async () => { for (const apply of staged) apply(); },
      };
    },
    runTransaction: async <T>(run: (tx: {
      get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
      set: (ref: { path: string }, data: Doc, options?: { merge?: boolean }) => void;
    }) => Promise<T>): Promise<T> => run({
      get: async (ref) => snapshot(ref.path),
      set: (ref, data, options) => {
        const next = options?.merge ? { ...(docs.get(ref.path) ?? {}), ...data } : { ...data };
        docs.set(ref.path, next);
        writes.push({ op: 'set', path: ref.path, data });
      },
    }),
  };

  return {
    adminDb,
    /** Seed or replace a document. */
    set(path: string, data: Doc) { docs.set(path, data); },
    /** Read the current state of a document, after the route has written it. */
    get(path: string) { return docs.get(path); },
    has(path: string) { return docs.has(path); },
    /** Every write the route performed, in order. */
    writes,
    /** Reset between tests without rebuilding the stub. */
    reset(next: Record<string, Doc> = {}) {
      docs.clear();
      for (const [key, value] of Object.entries(next)) docs.set(key, value);
      writes.length = 0;
    },
  };
}
