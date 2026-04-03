export const DEFAULT_WORKSPACE_ID = 'default';
export const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function getWorkspaceId(input?: string | null) {
  const raw = (input || '').trim();
  return raw || DEFAULT_WORKSPACE_ID;
}

export function isValidWorkspaceId(id: string) {
  return id === DEFAULT_WORKSPACE_ID || WORKSPACE_ID_PATTERN.test(id);
}
