import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import type { PlanTier } from '@/lib/stripe/plans';
import { z } from 'zod';

const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(['admin', 'member', 'analyst']),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** GET /api/team — list all members of the current workspace */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);

    const snap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/members`)
      .get();

    const members = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    return apiOk({ members });
  } catch (error) {
    return apiError(error);
  }
}

/** POST /api/team — invite a user by email, or update their role if already a member */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'team.manage');

    const body = await req.json();
    const { email, role } = inviteSchema.parse(body);
    const normalizedEmail = normalizeEmail(email);

    // Enforce team member limit based on plan
    const sub = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    const tier = (sub?.tier ?? 'starter') as PlanTier;
    const limit = PLANS[tier]?.limits.teamMembers ?? 1;

    if (limit !== -1) {
      const membersSnap = await adminDb
        .collection(`workspaces/${ctx.workspaceId}/members`)
        .get();
      if (membersSnap.size >= limit) {
        return apiError(new Error('TEAM_LIMIT_REACHED'));
      }
    }

    // Look up the invitee's Firebase account by email
    let inviteeUid: string;
    try {
      const userRecord = await adminAuth.getUserByEmail(normalizedEmail);
      inviteeUid = userRecord.uid;
    } catch {
      // User hasn't signed up yet — store a pending invite by email
      const pendingRef = adminDb
        .collection(`workspaces/${ctx.workspaceId}/pendingInvites`)
        .doc(normalizedEmail);
      await pendingRef.set({
        email: normalizedEmail,
        role,
        invitedBy: ctx.uid,
        invitedAt: new Date().toISOString(),
      });
      return apiOk({ status: 'pending', email: normalizedEmail });
    }

    // User exists — add them directly
    const memberRef = adminDb.doc(
      `workspaces/${ctx.workspaceId}/members/${inviteeUid}`,
    );
    const existing = await memberRef.get();

    // Never downgrade an owner via invite
    if (existing.exists && existing.data()?.role === 'owner') {
      return apiOk({ status: 'already_owner', uid: inviteeUid });
    }

    await memberRef.set(
      { uid: inviteeUid, email: normalizedEmail, role, joinedAt: new Date().toISOString() },
      { merge: true },
    );

    return apiOk({ status: 'added', uid: inviteeUid, email: normalizedEmail, role });
  } catch (error) {
    return apiError(error);
  }
}
