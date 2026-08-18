/**
 * TikTok hand-off email.
 *
 * TikTok's API cannot publish on a creator's behalf: Markaestro uploads the
 * video and TikTok drops it in the creator's inbox, where they must open the
 * app and post it themselves. Nothing on our side signals that, so a scheduled
 * TikTok post could sit unposted indefinitely. This email is the prompt.
 */

import { adminDb } from '@/lib/firebase-admin';
import { sendResendEmail } from '@/lib/resend';
import { BRAND, brandWrap, escapeHtml, getBaseUrl, getEmailTranslator, strongTag, type AuthEmailPayload } from '@/lib/auth-emails';
import { logger } from '@/lib/logger';
import { isAppLocale, routing, type AppLocale } from '@/i18n/routing';

const MAX_RECIPIENTS = 5;

export async function tiktokInboxEmail(params: {
  brandName?: string | null;
  caption: string;
  locale: AppLocale;
}): Promise<AuthEmailPayload> {
  const t = await getEmailTranslator(params.locale);
  const subject = params.brandName
    ? t('tiktokInbox.subjectWithBrand', { brandName: params.brandName })
    : t('tiktokInbox.subjectNoBrand');
  const queueUrl = `${getBaseUrl()}/content`;

  const html = brandWrap({
    locale: params.locale,
    title: subject,
    preheader: t('tiktokInbox.preheader'),
    bodyHtml: `
      <p style="margin:0 0 16px 0;">${
        params.brandName
          ? t.markup('tiktokInbox.bodyIntroWithBrand', { brandName: escapeHtml(params.brandName), ...strongTag })
          : escapeHtml(t('tiktokInbox.bodyIntroNoBrand'))
      }</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="${BRAND.panelBg}" style="background-color:${BRAND.panelBg};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.6;color:${BRAND.ink};">
            <strong style="display:block;margin-bottom:8px;">${escapeHtml(t('tiktokInbox.toPublishLabel'))}</strong>
            1. ${escapeHtml(t('tiktokInbox.step1'))}<br />
            2. ${escapeHtml(t('tiktokInbox.step2'))}<br />
            3. ${escapeHtml(t('tiktokInbox.step3'))}
          </td>
        </tr>
      </table>
      ${params.caption ? `<p style="margin:20px 0 8px 0;font-size:13px;color:${BRAND.muted};">${escapeHtml(t('tiktokInbox.captionLabel'))}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
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
      <p style="margin:16px 0 0 0;font-size:13px;color:${BRAND.muted};">${escapeHtml(t('tiktokInbox.closingNote'))}</p>
    `,
    footerNote: t('tiktokInbox.footerNote'),
    copyrightText: t('shared.copyright', { year: new Date().getFullYear() }),
  });

  const text = [
    subject,
    '',
    t('tiktokInbox.plain.bodyIntro'),
    '',
    t('tiktokInbox.plain.toPublishLabel'),
    `1. ${t('tiktokInbox.step1')}`,
    `2. ${t('tiktokInbox.step2')}`,
    `3. ${t('tiktokInbox.step3')}`,
    '',
    params.caption ? `${t('tiktokInbox.plain.captionLabel')}\n${params.caption}\n` : '',
    t('tiktokInbox.plain.queueLink', { url: queueUrl }),
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

async function getRecipients(workspaceId: string): Promise<Array<{ email: string; locale: AppLocale }>> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/members`)
    .where('role', 'in', ['owner', 'admin'])
    .limit(MAX_RECIPIENTS)
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

async function getBrandName(workspaceId: string, productId: unknown): Promise<string | null> {
  if (typeof productId !== 'string' || !productId) return null;
  try {
    const snap = await adminDb.doc(`workspaces/${workspaceId}/products/${productId}`).get();
    const name = snap.data()?.name;
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort: the post has already reached TikTok's inbox by the time this
 * runs, so a mail failure must never change the post's outcome. Sending is
 * guarded by `tiktokInboxEmailSentAt` so a repeated poll cannot mail twice.
 */
export async function sendTikTokInboxEmail(
  workspaceId: string,
  postId: string,
  post: Record<string, unknown>,
): Promise<void> {
  try {
    if (post.tiktokInboxEmailSentAt) return;

    const recipients = await getRecipients(workspaceId);
    if (recipients.length === 0) return;

    const brandName = await getBrandName(workspaceId, post.productId);
    const caption = String(post.content || '');

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
        const payload = await tiktokInboxEmail({ brandName, caption, locale });
        await sendResendEmail({
          to: emails,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        });
      }),
    );

    await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
      tiktokInboxEmailSentAt: new Date().toISOString(),
    });

    logger.info('tiktok inbox email sent', {
      event: 'posts.tiktok_inbox.email_sent',
      workspaceId,
      postId,
      recipients: recipients.length,
    });
  } catch (error) {
    logger.warn('tiktok inbox email failed', {
      event: 'posts.tiktok_inbox.email_failed',
      workspaceId,
      postId,
      err: error,
    });
  }
}
