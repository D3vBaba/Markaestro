/**
 * Client-side API helpers for authenticated requests.
 */

/** Default timeout applied to every API request. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Uploads get longer since large files legitimately take a while. */
const UPLOAD_TIMEOUT_MS = 60_000;

let _getIdToken: (() => Promise<string | null>) | null = null;
let _authReady: Promise<void> | null = null;
let _resolveAuthReady: (() => void) | null = null;

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
    data: { error: 'REQUEST_TIMEOUT', message: 'The request timed out. Please try again.' } as T,
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** Make an authenticated JSON request to our API. */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  // Wait for auth to initialize before making any request
  if (_authReady) await _authReady;

  const token = _getIdToken ? await _getIdToken() : null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(path, {
      ...init,
      // Callers that pass their own signal keep it; everyone else gets the
      // default timeout.
      signal: init.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (isAbortError(err)) return timeoutResult<T>();
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** GET shortcut with workspace ID. */
export function apiGet<T = unknown>(path: string, wsId = 'default') {
  const sep = path.includes('?') ? '&' : '?';
  return apiFetch<T>(`${path}${sep}workspaceId=${wsId}`);
}

/** POST shortcut with workspace ID. */
export function apiPost<T = unknown>(path: string, body: unknown, wsId = 'default') {
  const sep = path.includes('?') ? '&' : '?';
  return apiFetch<T>(`${path}${sep}workspaceId=${wsId}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** PUT shortcut with workspace ID. */
export function apiPut<T = unknown>(path: string, body: unknown, wsId = 'default') {
  const sep = path.includes('?') ? '&' : '?';
  return apiFetch<T>(`${path}${sep}workspaceId=${wsId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** DELETE shortcut with workspace ID. Optionally accepts a JSON body. */
export function apiDelete<T = unknown>(path: string, body?: unknown, wsId = 'default') {
  const sep = path.includes('?') ? '&' : '?';
  return apiFetch<T>(`${path}${sep}workspaceId=${wsId}`, {
    method: 'DELETE',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Upload a file via FormData (does NOT set Content-Type — browser adds multipart boundary). */
export async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  wsId = 'default',
): Promise<{ ok: boolean; status: number; data: T }> {
  if (_authReady) await _authReady;
  const token = _getIdToken ? await _getIdToken() : null;
  const sep = path.includes('?') ? '&' : '?';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const res = await fetch(`${path}${sep}workspaceId=${wsId}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      signal: controller.signal,
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (isAbortError(err)) return timeoutResult<T>();
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
