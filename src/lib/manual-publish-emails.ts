/**
 * Reminder email for manual-publish posts: when a post lands in the manual
 * posting queue (scheduled time reached, or an API client queued a publish),
 * workspace owners/admins get a nudge to post it natively.
 */

import { adminDb } from '@/lib/firebase-admin';
import { sendResendEmail } from '@/lib/resend';
import { BRAND, brandWrap, escapeHtml, getBaseUrl, getEmailTranslator, type AuthEmailPayload } from '@/lib/auth-emails';
import { getSocialChannelLabel } from '@/lib/social/channel-catalog';
import { logger } from '@/lib/logger';
import { isAppLocale, routing, type AppLocale } from '@/i18n/routing';

const MAX_REMINDER_RECIPIENTS = 5;

export async function manualPostReminderEmail(params: {
  channelLabel: string;
  caption: string;
  locale: AppLocale;
}): Promise<AuthEmailPayload> {
  const t = await getEmailTranslator(params.locale);
  const title = t('manualPostReminder.subject', { channelLabel: params.channelLabel });
  const queueUrl = `${getBaseUrl()}/content`;

  const html = brandWrap({
    locale: params.locale,
    title,
    preheader: t('manualPostReminder.preheader', { channelLabel: params.channelLabel }),
    bodyHtml: `
      <p style="margin:0 0 16px 0;">${escapeHtml(t('manualPostReminder.bodyIntro', { channelLabel: params.channelLabel }))}</p>
      ${params.caption ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="${BRAND.panelBg}" style="background-color:${BRAND.panelBg};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.6;color:${BRAND.ink};white-space:pre-wrap;">${escapeHtml(params.caption)}</td>
        </tr>
      </table>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0 0;">
        <tr>
          <td bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};border-radius:10px;">
            <a href="${queueUrl}" style="display:inline-block;padding:12px 22px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(t('shared.ctaOpenQueue'))}</a>
          </td>
        </tr>
      </table>
    `,
    footerNote: t('manualPostReminder.footerNote'),
    copyrightText: t('shared.copyright', { year: new Date().getFullYear() }),
  });

  const text = [
    t('manualPostReminder.plain.heading', { channelLabel: params.channelLabel }),
    '',
    params.caption ? `${t('manualPostReminder.plain.captionLabel')}\n${params.caption}\n` : '',
    t('manualPostReminder.plain.queueLink', { url: queueUrl }),
  ].filter(Boolean).join('\n');

  return { subject: title, html, text };
}

async function getReminderRecipients(workspaceId: string): Promise<Array<{ email: string; locale: AppLocale }>> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/members`)
    .where('role', 'in', ['owner', 'admin'])
    .limit(MAX_REMINDER_RECIPIENTS)
    .get();

  return snap.docs
    .map((doc) => {
      const data = doc.data();
      const email = data?.email;
      const locale = isAppLocale(data?.locale) ? data.locale : routing.defaultLocale;
      return typeof email === 'string' && email.includes('@') ? { email, locale } : null;
    })
    .filter((r): r is { email: string; locale: AppLocale } => r !== null);
}

/**
 * Best-effort: reminder delivery must never fail the publish transition that
 * triggered it, so every error is swallowed and logged.
 */
export async function sendManualPostReminderEmail(
  workspaceId: string,
  postId: string,
  post: Record<string, unknown>,
): Promise<void> {
  try {
    const recipients = await getReminderRecipients(workspaceId);
    if (recipients.length === 0) return;

    const channelLabel = getSocialChannelLabel(String(post.channel || ''));

    // Recipients can each have their own locale preference — group them so
    // every group gets a body rendered in its own language rather than one
    // language for the whole batch.
    const byLocale = new Map<AppLocale, string[]>();
    for (const { email, locale } of recipients) {
      const group = byLocale.get(locale) ?? [];
      group.push(email);
      byLocale.set(locale, group);
    }

    await Promise.all(
      Array.from(byLocale.entries()).map(async ([locale, emails]) => {
        const payload = await manualPostReminderEmail({
          channelLabel,
          caption: String(post.content || ''),
          locale,
        });
        await sendResendEmail({
          to: emails,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        });
      }),
    );
  } catch (error) {
    logger.warn('manual post reminder email failed', {
      event: 'posts.manual_reminder.email_failed',
      workspaceId,
      postId,
      err: error,
    });
  }
}
