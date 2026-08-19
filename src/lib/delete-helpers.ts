export type WorkspaceMembership = {
  workspaceId: string;
  role: string;
};

export function confirmationMatchesEmail(confirmation: string, email: string): boolean {
  return confirmation.trim().toLowerCase() === email.trim().toLowerCase();
}

export function splitOwnedAndJoined(memberships: WorkspaceMembership[]): {
  ownedIds: string[];
  joinedIds: string[];
} {
  const ownedIds: string[] = [];
  const joinedIds: string[] = [];
  for (const membership of memberships) {
    if (!membership.workspaceId) continue;
    if (membership.role === 'owner') ownedIds.push(membership.workspaceId);
    else joinedIds.push(membership.workspaceId);
  }
  return { ownedIds, joinedIds };
}
