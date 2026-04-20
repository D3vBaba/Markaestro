import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import type { PlanTier } from '@/lib/stripe/plans';
import { sendResendEmail } from '@/lib/resend';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { z } from 'zod';

export const runtime = 'nodejs';

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

    const [membersSnap, invitesSnap] = await Promise.all([
      adminDb.collection(`workspaces/${ctx.workspaceId}/members`).get(),
      adminDb.collection(`workspaces/${ctx.workspaceId}/pendingInvites`).get(),
    ]);

    const members = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    const pendingInvites = invitesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return apiOk({ members, pendingInvites });
  } catch (error) {
    return apiError(error);
  }
}

async function sendInviteEmail(params: {
  to: string;
  workspaceName: string;
  role: string;
  inviterEmail?: string;
  appUrl: string;
}): Promise<void> {
  const { to, workspaceName, role, inviterEmail, appUrl } = params;
  try {
    await sendResendEmail({
      to,
      subject: `You've been invited to join ${workspaceName} on Markaestro`,
      html: `
        <p>Hi,</p>
        <p>${inviterEmail ? `<strong>${inviterEmail}</strong>` : 'A teammate'} has invited you to join the <strong>${workspaceName}</strong> workspace on Markaestro as a <strong>${role}</strong>.</p>
        <p>Sign in (or create an account) using this email address and the invitation will be applied automatically:</p>
        <p><a href="${appUrl}/login">${appUrl}/login</a></p>
        <p>If you don't want to join, simply ignore this email — the invitation will expire after 30 days.</p>
      `.trim(),
      text: `${inviterEmail || 'A teammate'} has invited you to join ${workspaceName} on Markaestro as a ${role}. Accept by signing in at ${appUrl}/login`,
    });
  } catch (err) {
    // Non-fatal — invite is persisted; the user can still accept on login.
    console.warn('[team.invite] email delivery failed (non-fatal):', err);
  }
}

/**
 * POST /api/team — invite a user by email.
 *
 * Always creates a pendingInvite document; users are added to the workspace
 * only after they sign in with a matching email (server-auth.acceptPendingInvites
 * claims the invite on login). This prevents unauthenticated admins from
 * attaching arbitrary Firebase users to their workspace without the user's
 * knowledge, and produces a non-enumerating response (same shape whether the
 * target email exists or not).
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'team.manage');
    await applyRateLimit(req, RATE_LIMITS.auth, {
      key: `team-invite:${ctx.uid}:${ctx.workspaceId}`,
    });

    const body = await req.json();
    const { email, role } = inviteSchema.parse(body);
    const normalizedEmail = normalizeEmail(email);

    const sub = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    const tier = (sub?.tier ?? 'starter') as PlanTier;
    const limit = PLANS[tier]?.limits.teamMembers ?? 1;

    const inviteRef = adminDb
      .collection(`workspaces/${ctx.workspaceId}/pendingInvites`)
      .doc(normalizedEmail);
    const workspaceRef = adminDb.doc(`workspaces/${ctx.workspaceId}`);

    const { workspaceName } = await adminDb.runTransaction(async (tx) => {
      // Limit enforcement under transaction to close a TOCTOU window: without
      // this, two concurrent invites near the cap could both succeed.
      if (limit !== -1) {
        const [membersSnap, invitesSnap] = await Promise.all([
          tx.get(adminDb.collection(`workspaces/${ctx.workspaceId}/members`)),
          tx.get(adminDb.collection(`workspaces/${ctx.workspaceId}/pendingInvites`)),
        ]);
        const existingInvite = await tx.get(inviteRef);
        const newInvite = existingInvite.exists ? 0 : 1;
        if (membersSnap.size + invitesSnap.size + newInvite > limit) {
          throw new Error('TEAM_LIMIT_REACHED');
        }
      }

      const wsSnap = await tx.get(workspaceRef);
      const name = (wsSnap.data()?.name as string) || 'your workspace';

      tx.set(
        inviteRef,
        {
          email: normalizedEmail,
          role,
          invitedBy: ctx.uid,
          invitedByEmail: ctx.email || '',
          invitedAt: new Date().toISOString(),
          // TTL: pending invites expire after 30 days. Requires the
          // expiresAt TTL policy configured in docs/operations/firestore-ttl.md
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        { merge: true },
      );

      return { workspaceName: name };
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://markaestro.com';
    await sendInviteEmail({
      to: normalizedEmail,
      workspaceName,
      role,
      inviterEmail: ctx.email,
      appUrl,
    });

    // Intentionally uniform response shape regardless of whether the
    // invitee has a Firebase account yet — don't leak account existence.
    return apiOk({ status: 'invited', email: normalizedEmail, role });
  } catch (error) {
    return apiError(error);
  }
}
