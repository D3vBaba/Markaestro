/**
 * Client-side API helpers for authenticated requests.
 */

/** Default timeout applied to every API request. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Workspace/account deletes walk a large Firestore tree and can exceed 15s. */
export const DESTRUCTIVE_REQUEST_TIMEOUT_MS = 120_000;
/** Uploads get longer since large files legitimately take a while. */
const UPLOAD_TIMEOUT_MS = 300_000;
const DIRECT_MEDIA_UPLOADS_ENABLED = process.env.NEXT_PUBLIC_DIRECT_MEDIA_UPLOADS_ENABLED === '1';

let _getIdToken: (() => Promise<string | null>) | null = null;
let _authReady: Promise<void> | null = null;
let _resolveAuthReady: (() => void) | null = null;
let _workspaceId = 'default';
const _workspaceListeners = new Set<() => void>();

/**
 * Keep generic API helpers aligned with the workspace selected in the UI.
 * Subscribers (useApiQuery) re-render on change so every cached read
 * re-keys to the new workspace.
 */
export function setApiWorkspaceId(workspaceId: string | null | undefined) {
  const next = workspaceId?.trim() || 'default';
  if (next === _workspaceId) return;
  _workspaceId = next;
  for (const fn of _workspaceListeners) fn();
}

export function getApiWorkspaceId(): string {
  return _workspaceId;
}

/** Subscribe to active-workspace changes (useSyncExternalStore contract). */
export function subscribeApiWorkspaceId(fn: () => void): () => void {
  _workspaceListeners.add(fn);
  return () => {
    _workspaceListeners.delete(fn);
  };
}

/**
 * Fired when the server rejects a request because the user is no longer a
 * member of the selected workspace (removed mid-session, workspace deleted).
 * WorkspaceProvider listens and resets the selection.
 */
export const WORKSPACE_FORBIDDEN_EVENT = 'markaestro:workspace-forbidden';

function notifyIfWorkspaceForbidden(status: number, data: unknown) {
  if (status !== 403 || typeof window === 'undefined') return;
  const error = (data as { error?: string } | null)?.error;
  if (error === 'FORBIDDEN_WORKSPACE') {
    window.dispatchEvent(new CustomEvent(WORKSPACE_FORBIDDEN_EVENT));
  }
}

function activeWorkspaceId(workspaceId?: string) {
  return workspaceId?.trim() || _workspaceId;
}

function withWorkspaceQuery(path: string, wsId?: string) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}workspaceId=${encodeURIComponent(activeWorkspaceId(wsId))}`;
}

// Create a promise that resolves when auth is ready
function _initAuthGate() {
  if (!_authReady) {
    _authReady = new Promise<void>((resolve) => {
      _resolveAuthReady = resolve;
    });
  }
}
_initAuthGate();

/** Called once by AuthProvider to wire the token getter. */
export function setTokenGetter(fn: () => Promise<string | null>) {
  _getIdToken = fn;
}

/** Called by AuthProvider once onAuthStateChanged has fired at least once. */
export function markAuthReady() {
  if (_resolveAuthReady) {
    _resolveAuthReady();
    _resolveAuthReady = null;
  }
}

function timeoutResult<T>(): { ok: boolean; status: number; data: T } {
  return {
    ok: false,
    status: 408,
    data: {
      error: 'REQUEST_TIMEOUT',
      message: 'The request timed out. Please try again.',
      userMessage: 'The request timed out. Please try again.',
    } as T,
  };
}

/** Header carrying the id that ties a client failure to the server's logs. */
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Client-minted request id, sent up so a user reporting "it failed at 3pm"
 * can be traced from a screenshot. The edge adopts it when it matches the
 * shape it validates (`[A-Za-z0-9_-]{8,128}`) and mints its own otherwise, so
 * a browser without `crypto.randomUUID` simply loses the correlation rather
 * than breaking the request.
 */
function newClientRequestId(): string | null {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Non-secure contexts throw rather than returning undefined.
  }
  return null;
}

/**
 * Parse a JSON body without letting a non-JSON response escape as a thrown
 * SyntaxError.
 *
 * Cloud Run 502s, load-balancer error pages, and Next's own HTML 500 page are
 * all bodies that `res.json()` rejects on. Every call site destructures
 * `{ ok, data }` without a try, so that rejection used to surface as an
 * unhandled error inside React instead of a failed request. The `ok`/`status`
 * contract now always holds.
 */
async function parseJsonBody<T>(res: Response, requestId: string | null): Promise<T> {
  const data = await res.json().catch(() => null);
  if (data && typeof data === 'object') {
    // Prefer the server's own id; fall back to what we sent so a failure with
    // no parseable body is still traceable.
    const record = data as Record<string, unknown>;
    if (typeof record.requestId !== 'string') {
      const serverId = res.headers.get(REQUEST_ID_HEADER) || requestId;
      if (serverId) record.requestId = serverId;
    }
    return data as T;
  }
  return {
    error: res.ok ? 'MALFORMED_RESPONSE' : 'INTERNAL_ERROR',
    requestId: res.headers.get(REQUEST_ID_HEADER) || requestId || undefined,
  } as T;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

type ApiFetchInit = RequestInit & { timeoutMs?: number };

/** Make an authenticated JSON request to our API. */
export async function apiFetch<T = unknown>(
  path: string,
  init: ApiFetchInit = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  // Wait for auth to initialize before making any request
  if (_authReady) await _authReady;

  const token = _getIdToken ? await _getIdToken() : null;
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchInit } = init;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestId = newClientRequestId();

  try {
    const res = await fetch(path, {
      ...fetchInit,
      // Callers that pass their own signal keep it; everyone else gets the
      // default timeout.
      signal: fetchInit.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
        ...(fetchInit.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const data = await parseJsonBody<T>(res, requestId);
    notifyIfWorkspaceForbidden(res.status, data);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (isAbortError(err)) return timeoutResult<T>();
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** GET shortcut with workspace ID. */
export function apiGet<T = unknown>(path: string, wsId?: string) {
  return apiFetch<T>(withWorkspaceQuery(path, wsId));
}

/** POST shortcut with workspace ID. */
export function apiPost<T = unknown>(
  path: string,
  body: unknown,
  wsId?: string,
  options?: { timeoutMs?: number },
) {
  return apiFetch<T>(withWorkspaceQuery(path, wsId), {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: options?.timeoutMs,
  });
}

/** PUT shortcut with workspace ID. */
export function apiPut<T = unknown>(path: string, body: unknown, wsId?: string) {
  return apiFetch<T>(withWorkspaceQuery(path, wsId), {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** PATCH shortcut with workspace ID. */
export function apiPatch<T = unknown>(path: string, body: unknown, wsId?: string) {
  return apiFetch<T>(withWorkspaceQuery(path, wsId), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE shortcut with workspace ID. Optionally accepts a JSON body. */
export function apiDelete<T = unknown>(path: string, body?: unknown, wsId?: string) {
  return apiFetch<T>(withWorkspaceQuery(path, wsId), {
    method: 'DELETE',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Download a file (e.g. CSV export) as a Blob. */
export async function apiDownload(
  path: string,
  wsId?: string,
): Promise<{ ok: boolean; status: number; blob: Blob | null }> {
  if (_authReady) await _authReady;
  const token = _getIdToken ? await _getIdToken() : null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const res = await fetch(withWorkspaceQuery(path, wsId), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    const blob = res.ok ? await res.blob() : null;
    return { ok: res.ok, status: res.status, blob };
  } catch (err) {
    if (isAbortError(err)) return { ok: false, status: 408, blob: null };
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Upload a file via FormData (does NOT set Content-Type — browser adds multipart boundary). */
export async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  wsId?: string,
): Promise<{ ok: boolean; status: number; data: T }> {
  if (DIRECT_MEDIA_UPLOADS_ENABLED && path === '/api/media/upload') {
    const file = (formData.get('image') || formData.get('video') || formData.get('file')) as File | null;
    if (file) {
      const session = await apiPost<{
        ok?: boolean;
        assetId?: string;
        uploadUrl?: string;
        contentType?: string;
        error?: string;
      }>('/api/media/create-upload-url', {
        name: file.name,
        type: file.type,
        size: file.size,
      }, wsId);

      // A rolling deployment can briefly put the new client in front of an
      // old server. Keep the established multipart route as a compatibility
      // fallback only when the new route is genuinely unavailable.
      if (session.status !== 404 && session.status !== 405) {
        if (!session.ok || !session.data.assetId || !session.data.uploadUrl) {
          return session as { ok: boolean; status: number; data: T };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
        try {
          const uploaded = await fetch(session.data.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': session.data.contentType || file.type },
            body: file,
            signal: controller.signal,
          });
          if (!uploaded.ok) {
            return {
              ok: false,
              status: uploaded.status,
              data: { error: 'DIRECT_UPLOAD_FAILED' } as T,
            };
          }
        } catch (error) {
          if (isAbortError(error)) return timeoutResult<T>();
          return { ok: false, status: 0, data: { error: 'DIRECT_UPLOAD_FAILED' } as T };
        } finally {
          clearTimeout(timeout);
        }

        const finalizeController = new AbortController();
        const finalizeTimeout = setTimeout(() => finalizeController.abort(), UPLOAD_TIMEOUT_MS);
        try {
          return await apiFetch<T>(
            withWorkspaceQuery('/api/media/finalize-upload', wsId),
            {
              method: 'POST',
              body: JSON.stringify({ assetId: session.data.assetId }),
              signal: finalizeController.signal,
            },
          );
        } finally {
          clearTimeout(finalizeTimeout);
        }
      }
    }
  }

  if (_authReady) await _authReady;
  const token = _getIdToken ? await _getIdToken() : null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  const requestId = newClientRequestId();

  try {
    const res = await fetch(withWorkspaceQuery(path, wsId), {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
      },
    });
    const data = await parseJsonBody<T>(res, requestId);
    notifyIfWorkspaceForbidden(res.status, data);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (isAbortError(err)) return timeoutResult<T>();
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
