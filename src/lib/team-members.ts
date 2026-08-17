import { adminDb } from '@/lib/firebase-admin';

/**
 * Revoke every active API client a member created in a workspace.
 *
 * API keys authenticate without a session, so they would otherwise outlive
 * the membership that justified them — a removed admin could keep publishing
 * to the workspace's social accounts indefinitely. Revocation (not deletion)
 * keeps the audit trail and daily stats.
 */
export async function revokeApiClientsOwnedBy(
  workspaceId: string,
  uid: string,
  reason: 'member_removed' | 'member_left',
): Promise<number> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/api_clients`)
    .where('ownerUid', '==', uid)
    .where('status', '==', 'active')
    .get();

  if (snap.empty) return 0;

  const now = new Date().toISOString();
  const batch = adminDb.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, { status: 'revoked', revokedAt: now, revokedReason: reason });
  }
  await batch.commit();
  return snap.size;
}

/**
 * Remove a member from a workspace and revoke the credentials that depended
 * on the membership. The member doc delete and key revocation are separate
 * writes; key revocation runs first so a crash between the two fails closed
 * (keys dead, membership still present) rather than open.
 */
export async function removeMemberWithCleanup(
  workspaceId: string,
  uid: string,
  reason: 'member_removed' | 'member_left',
): Promise<{ revokedApiClients: number }> {
  const revokedApiClients = await revokeApiClientsOwnedBy(workspaceId, uid, reason);
  await adminDb.doc(`workspaces/${workspaceId}/members/${uid}`).delete();
  return { revokedApiClients };
}
