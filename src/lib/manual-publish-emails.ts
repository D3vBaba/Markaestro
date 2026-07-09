/**
 * Reminder email for manual-publish posts: when a post lands in the manual
 * posting queue (scheduled time reached, or an API client queued a publish),
 * workspace owners/admins get a nudge to post it natively.
 */

import { adminDb } from '@/lib/firebase-admin';
import { sendResendEmail } from '@/lib/resend';
import { BRAND, brandWrap, escapeHtml, getBaseUrl, type AuthEmailPayload } from '@/lib/auth-emails';
import { getSocialChannelLabel } from '@/lib/social/channel-catalog';
import { logger } from '@/lib/logger';

const MAX_REMINDER_RECIPIENTS = 5;
const CAPTION_PREVIEW_LENGTH = 240;

export function manualPostReminderEmail(params: {
  channelLabel: string;
  caption: string;
}): AuthEmailPayload {
  const title = `Your ${params.channelLabel} post is ready`;
  const queueUrl = `${getBaseUrl()}/content`;
  const preview = params.caption.length > CAPTION_PREVIEW_LENGTH
    ? `${params.caption.slice(0, CAPTION_PREVIEW_LENGTH)}…`
    : params.caption;

  const html = brandWrap({
    title,
    preheader: `A ${params.channelLabel} post is waiting in your To Post queue.`,
    bodyHtml: `
      <p style="margin:0 0 16px 0;">A post is waiting in your To Post queue. Grab the media and caption from Markaestro, publish it from the ${escapeHtml(params.channelLabel)} app, then mark it as posted.</p>
      ${preview ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="${BRAND.panelBg}" style="background-color:${BRAND.panelBg};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.6;color:${BRAND.ink};white-space:pre-wrap;">${escapeHtml(preview)}</td>
        </tr>
      </table>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0 0;">
        <tr>
          <td bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};border-radius:10px;">
            <a href="${queueUrl}" style="display:inline-block;padding:12px 22px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Open your To Post queue</a>
          </td>
        </tr>
      </table>
    `,
    footerNote: 'You are receiving this because a post in your Markaestro workspace is waiting to be published manually.',
  });

  const text = [
    `Your ${params.channelLabel} post is ready to publish`,
    '',
    preview ? `Caption:\n${preview}\n` : '',
    `Open your To Post queue: ${queueUrl}`,
  ].filter(Boolean).join('\n');

  return { subject: title, html, text };
}

async function getReminderRecipients(workspaceId: string): Promise<string[]> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/members`)
    .where('role', 'in', ['owner', 'admin'])
    .limit(MAX_REMINDER_RECIPIENTS)
    .get();

  return snap.docs
    .map((doc) => doc.data()?.email)
    .filter((email): email is string => typeof email === 'string' && email.includes('@'));
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
    const payload = manualPostReminderEmail({
      channelLabel,
      caption: String(post.content || ''),
    });

    await sendResendEmail({
      to: recipients,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
  } catch (error) {
    logger.warn('manual post reminder email failed', {
      event: 'posts.manual_reminder.email_failed',
      workspaceId,
      postId,
      err: error,
    });
  }
}
