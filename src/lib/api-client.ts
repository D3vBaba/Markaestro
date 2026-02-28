/**
 * Client-side API helpers for authenticated requests.
 */

let _getIdToken: (() => Promise<string | null>) | null = null;

/** Called once by AuthProvider to wire the token getter. */
export function setTokenGetter(fn: () => Promise<string | null>) {
  _getIdToken = fn;
}

/** Make an authenticated JSON request to our API. */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const token = _getIdToken ? await _getIdToken() : null;

  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
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

/** DELETE shortcut with workspace ID. */
export function apiDelete<T = unknown>(path: string, wsId = 'default') {
  const sep = path.includes('?') ? '&' : '?';
  return apiFetch<T>(`${path}${sep}workspaceId=${wsId}`, {
    method: 'DELETE',
  });
}
