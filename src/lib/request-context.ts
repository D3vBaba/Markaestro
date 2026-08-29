/**
 * Ambient per-request context (request id, uid, workspace id).
 *
 * The problem this solves: `apiError()` used to mint a fresh
 * `crypto.randomUUID()` at the moment of failure and hand it to the user,
 * while every log line emitted earlier in the same request carried either no
 * id or a different one. The id in a support screenshot therefore matched
 * nothing in Cloud Logging.
 *
 * The id is minted once at the edge (`src/proxy.ts`), forwarded on the
 * `x-request-id` request header, and adopted here by the first auth helper
 * that sees the request. `logger` then stamps it on every line automatically
 * and `apiError` returns the same value to the caller.
 *
 * `enterWith` rather than `run`: adopting the context has to be a one-line
 * call from inside `requireContext()`, and everything *after* that call in the
 * route handler must see it. `run(store, fn)` cannot do that without wrapping
 * all 112 route handlers.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

export type RequestContextStore = {
  requestId: string;
  uid?: string;
  workspaceId?: string;
};

const storage = new AsyncLocalStorage<RequestContextStore>();

/** Header the edge sets and the client may supply. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Request ids are echoed back to users and written to logs, so they must not
 * be able to carry arbitrary caller-controlled text. Accept the shapes we
 * mint plus Cloud Run's trace id, and nothing else.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Read a request id off inbound headers, preferring an explicit
 * `x-request-id` (set by our own edge or by the browser client) and falling
 * back to Cloud Run's injected trace id. Returns null when neither is usable,
 * so callers decide whether to mint.
 */
export function requestIdFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get(REQUEST_ID_HEADER);
  if (isValidRequestId(forwarded)) return forwarded;

  const trace = headers.get('x-cloud-trace-context');
  if (trace) {
    const traceId = trace.split('/')[0] || trace;
    if (isValidRequestId(traceId)) return traceId;
  }

  return null;
}

/**
 * Adopt (or mint) the ambient request context for the current async flow.
 * Idempotent: calling it twice in one request keeps the first id, so a route
 * that calls both `requireContext` and a public-API auth helper does not end
 * up with two ids for one request.
 */
export function enterRequestContext(
  input: { headers?: Headers; requestId?: string; uid?: string; workspaceId?: string } = {},
): RequestContextStore {
  const existing = storage.getStore();
  if (existing) {
    if (input.uid && !existing.uid) existing.uid = input.uid;
    if (input.workspaceId) existing.workspaceId = input.workspaceId;
    return existing;
  }

  const requestId =
    (isValidRequestId(input.requestId) ? input.requestId : null) ??
    (input.headers ? requestIdFromHeaders(input.headers) : null) ??
    newRequestId();

  const store: RequestContextStore = {
    requestId,
    uid: input.uid,
    workspaceId: input.workspaceId,
  };
  storage.enterWith(store);
  return store;
}

/** Attach identity to a context that already exists. No-op outside one. */
export function annotateRequestContext(fields: { uid?: string; workspaceId?: string }): void {
  const store = storage.getStore();
  if (!store) return;
  if (fields.uid) store.uid = fields.uid;
  if (fields.workspaceId) store.workspaceId = fields.workspaceId;
}

export function getRequestContext(): RequestContextStore | undefined {
  return storage.getStore();
}

/** The ambient request id, or null when running outside a request. */
export function getRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

/** Run `fn` inside a fresh context. Used by workers and by tests. */
export function withRequestContext<T>(store: RequestContextStore, fn: () => T): T {
  return storage.run(store, fn);
}
