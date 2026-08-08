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
import { BRAND, brandWrap, escapeHtml, getBaseUrl, type AuthEmailPayload } from '@/lib/auth-emails';
import { logger } from '@/lib/logger';

const MAX_RECIPIENTS = 5;
const CAPTION_PREVIEW_LENGTH = 240;

export function tiktokInboxEmail(params: {
  brandName?: string | null;
  caption: string;
}): AuthEmailPayload {
  const subject = params.brandName
    ? `Finish your TikTok post for ${params.brandName}`
    : 'Finish your TikTok post';
  const queueUrl = `${getBaseUrl()}/content`;
  const preview = params.caption.length > CAPTION_PREVIEW_LENGTH
    ? `${params.caption.slice(0, CAPTION_PREVIEW_LENGTH)}…`
    : params.caption;

  const html = brandWrap({
    title: subject,
    preheader: 'Your video is waiting in the TikTok app — open it to publish.',
    bodyHtml: `
      <p style="margin:0 0 16px 0;">Your video has been uploaded and is waiting in your TikTok inbox${
        params.brandName ? ` for <strong>${escapeHtml(params.brandName)}</strong>` : ''
      }. TikTok requires the final post to be made from their app, so it is not live yet.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="${BRAND.panelBg}" style="background-color:${BRAND.panelBg};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.6;color:${BRAND.ink};">
            <strong style="display:block;margin-bottom:8px;">To publish it</strong>
            1. Open the TikTok app<br />
            2. Go to your inbox notifications<br />
            3. Open the uploaded video, adjust the caption or privacy if you want, and post
          </td>
        </tr>
      </table>
      ${preview ? `<p style="margin:20px 0 8px 0;font-size:13px;color:${BRAND.muted};">Your caption</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
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
      <p style="margin:16px 0 0 0;font-size:13px;color:${BRAND.muted};">Once it is live, mark it as posted in Markaestro so your analytics stay accurate.</p>
    `,
    footerNote: 'You are receiving this because a TikTok post in your Markaestro workspace is waiting to be published.',
  });

  const text = [
    subject,
    '',
    'Your video has been uploaded and is waiting in your TikTok inbox. TikTok requires the final post to be made from their app, so it is not live yet.',
    '',
    'To publish it:',
    '1. Open the TikTok app',
    '2. Go to your inbox notifications',
    '3. Open the uploaded video, adjust the caption or privacy if you want, and post',
    '',
    preview ? `Your caption:\n${preview}\n` : '',
    `Open your To Post queue: ${queueUrl}`,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

async function getRecipients(workspaceId: string): Promise<string[]> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/members`)
    .where('role', 'in', ['owner', 'admin'])
    .limit(MAX_RECIPIENTS)
    .get();

  return snap.docs
    .map((doc) => doc.data()?.email)
    .filter((email): email is string => typeof email === 'string' && email.includes('@'));
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

    const payload = tiktokInboxEmail({
      brandName: await getBrandName(workspaceId, post.productId),
      caption: String(post.content || ''),
    });

    await sendResendEmail({
      to: recipients,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

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
