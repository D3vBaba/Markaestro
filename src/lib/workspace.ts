export const DEFAULT_WORKSPACE_ID = 'default';

export function getWorkspaceId(input?: string | null) {
  const raw = (input || '').trim();
  return raw || DEFAULT_WORKSPACE_ID;
}
