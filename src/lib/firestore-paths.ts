import { getWorkspaceId } from './workspace';

export function workspaceCollection(workspaceId: string | null | undefined, collection: string) {
  const ws = getWorkspaceId(workspaceId);
  return `workspaces/${ws}/${collection}`;
}
