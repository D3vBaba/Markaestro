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

function isSelectableWorkspaceId(id: string | null | undefined): id is string {
  return Boolean(id && id !== DEFAULT_WORKSPACE_ID);
}

/**
 * Choose which workspace the UI should have open after a list refresh.
 *
 * An explicit `preferredId` (invite accept, create, switch) always wins,
 * even if the list has not caught up yet — data reads use a direct
 * membership get, so a just-joined workspace is already addressable.
 * Without a preference, keep the live selection if it still exists, then
 * the persisted one, then the first listed workspace.
 */
export function pickSelectedWorkspaceId(opts: {
  workspaceIds: string[];
  previousId: string;
  storedId: string | null;
  preferredId?: string | null;
}): string {
  if (isSelectableWorkspaceId(opts.preferredId)) return opts.preferredId;
  if (isSelectableWorkspaceId(opts.previousId) && opts.workspaceIds.includes(opts.previousId)) {
    return opts.previousId;
  }
  if (isSelectableWorkspaceId(opts.storedId) && opts.workspaceIds.includes(opts.storedId)) {
    return opts.storedId;
  }
  return opts.workspaceIds[0] ?? DEFAULT_WORKSPACE_ID;
}

/**
 * Prepend a workspace the client knows about (just joined / created) when
 * the list endpoint has not returned it yet, so the switcher can show it.
 */
export function mergeWorkspaceHint<T extends { id: string }>(
  workspaces: T[],
  hint: T | null | undefined,
): T[] {
  if (!isSelectableWorkspaceId(hint?.id)) return workspaces;
  if (workspaces.some((workspace) => workspace.id === hint.id)) return workspaces;
  return [hint, ...workspaces];
}

/**
 * Brand-new invitees must not get an empty personal workspace on first
 * request — that workspace becomes the owned-first default and hides the
 * team they were invited to. Defer bootstrap until they accept or the
 * invite is gone. Unverified emails cannot redeem invites, so they still
 * get a personal workspace.
 */
export function shouldDeferPersonalWorkspace(
  emailVerified: boolean,
  pendingInviteCount: number,
): boolean {
  return emailVerified && pendingInviteCount > 0;
}
