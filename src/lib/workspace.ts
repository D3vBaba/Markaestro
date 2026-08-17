export const DEFAULT_WORKSPACE_ID = 'default';
export const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

/**
 * Cookie carrying the user's selected workspace. Written by the client on
 * switch, read by the server whenever a request doesn't name a workspace
 * explicitly — so SSR and workspace-blind fetches still land in the
 * workspace the user actually has open.
 */
export const WORKSPACE_COOKIE = 'markaestro_ws';

export function getWorkspaceId(input?: string | null) {
  const raw = (input || '').trim();
  return raw || DEFAULT_WORKSPACE_ID;
}

export function isValidWorkspaceId(id: string) {
  return id === DEFAULT_WORKSPACE_ID || WORKSPACE_ID_PATTERN.test(id);
}

/**
 * Build a valid, effectively-unique workspace id from a display name.
 * The base is truncated so the id always fits WORKSPACE_ID_PATTERN's 80-char
 * cap, and names with no usable characters fall back to 'workspace' instead
 * of producing an id that fails validation and becomes unreachable.
 */
export function workspaceSlugFromName(name: string, nowMs = Date.now()): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
    .slice(0, 40).replace(/-+$/, '') || 'workspace';
  return `${base}-${nowMs.toString(36)}`;
}
