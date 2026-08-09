import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import type { PlanTier } from '@/lib/stripe/plans';
import { sendResendEmail } from '@/lib/resend';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { brandWrap, escapeHtml, getEmailTranslator, strongTag, type AuthEmailPayload } from '@/lib/auth-emails';
import { resolveMemberLocale } from '@/lib/resolve-app-locale';
import { pickLocaleFromAcceptLanguage, routing, type AppLocale } from '@/i18n/routing';
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

async function buildInviteEmail(params: {
  workspaceName: string;
  role: 'admin' | 'member' | 'analyst';
  inviterEmail?: string;
  appUrl: string;
  locale: AppLocale;
}): Promise<AuthEmailPayload> {
  const { workspaceName, role, inviterEmail, appUrl, locale } = params;
  const t = await getEmailTranslator(locale);
  const loginUrl = `${appUrl}/login`;
  const roleLabel = t(`teamInvite.roleLabels.${role}`);
  const subject = t('teamInvite.subject', { workspaceName });

  const html = brandWrap({
    locale,
    title: t('teamInvite.title'),
    preheader: t('teamInvite.preheader', { workspaceName }),
    bodyHtml: `
      <p style="margin:0 0 16px 0;">${escapeHtml(t('teamInvite.greeting'))}</p>
      <p style="margin:0 0 16px 0;">${
        inviterEmail
          ? t.markup('teamInvite.bodyIntroWithInviter', { inviterEmail: escapeHtml(inviterEmail), workspaceName: escapeHtml(workspaceName), roleLabel: escapeHtml(roleLabel), ...strongTag })
          : t.markup('teamInvite.bodyIntroNoInviter', { workspaceName: escapeHtml(workspaceName), roleLabel: escapeHtml(roleLabel), ...strongTag })
      }</p>
      <p style="margin:0 0 8px 0;">${escapeHtml(t('teamInvite.signInInstructions'))}</p>
      <p style="margin:0 0 16px 0;"><a href="${loginUrl}" style="color:#2563eb;">${escapeHtml(loginUrl)}</a></p>
    `,
    footerNote: t('teamInvite.declineNote'),
    copyrightText: t('shared.copyright', { year: new Date().getFullYear() }),
  });

  const text = t('teamInvite.plain.summary', {
    inviter: inviterEmail || t('teamInvite.plain.fallbackInviter'),
    workspaceName,
    roleLabel,
    url: loginUrl,
  });

  return { subject, html, text };
}

async function sendInviteEmail(params: {
  to: string;
  workspaceName: string;
  role: 'admin' | 'member' | 'analyst';
  inviterEmail?: string;
  inviterUid?: string;
  inviterAcceptLanguage?: string | null;
  appUrl: string;
}): Promise<void> {
  const { to, inviterUid, inviterAcceptLanguage, ...rest } = params;
  try {
    // The invitee has no member doc yet (they may not even have an account),
    // so there's no locale to read for them — use the inviter's own
    // preference instead, since they're the one who chose the team's
    // working language.
    const locale =
      (inviterUid ? await resolveMemberLocale(inviterUid) : null) ??
      pickLocaleFromAcceptLanguage(inviterAcceptLanguage) ??
      routing.defaultLocale;
    const payload = await buildInviteEmail({ ...rest, locale });
    await sendResendEmail({ to, subject: payload.subject, html: payload.html, text: payload.text });
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
      inviterUid: ctx.uid,
      inviterAcceptLanguage: req.headers.get('accept-language'),
      appUrl,
    });

    // Intentionally uniform response shape regardless of whether the
    // invitee has a Firebase account yet — don't leak account existence.
    return apiOk({ status: 'invited', email: normalizedEmail, role });
  } catch (error) {
    return apiError(error);
  }
}
