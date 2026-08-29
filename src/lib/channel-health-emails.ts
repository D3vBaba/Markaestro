/**
 * Proactive channel-health warnings.
 *
 * The integration status machine already models `connected`, `expired`,
 * `revoked`, and `error`, and `markConnectionAuthError` writes to it. Nothing
 * told a user their Instagram token had died until they tried to publish, and
 * for a scheduled post that means finding out after the publish window has
 * passed.
 *
 * This is the active half of that fix: in the worker tick, a workspace with
 * scheduled posts in the next 24 hours targeting a channel that is not ready
 * gets one email. It converts a silent scheduled-post failure into a fixable
 * warning, which is the highest-value email in the product.
 *
 * The passive half is the dashboard banner, which reads
 * `/api/social/channels` directly and needs nothing here.
 */

import { adminDb } from '@/lib/firebase-admin';
import { sendResendEmail } from '@/lib/resend';
import {
  BRAND,
  brandWrap,
  escapeHtml,
  getBaseUrl,
  getEmailTranslator,
  type AuthEmailPayload,
} from '@/lib/auth-emails';
import { getSocialChannelLabel } from '@/lib/social/channel-catalog';
import { getUnavailableSocialChannels } from '@/lib/social/channel-status';
import { logger } from '@/lib/logger';
import { isAppLocale, routing, type AppLocale } from '@/i18n/routing';
import type { SocialChannel } from '@/lib/schemas';
import { getPostTargetChannels } from '@/lib/social/publisher';

/**
 * One warning per channel per 72 hours.
 *
 * A token stays broken until someone reconnects it, and the tick runs
 * constantly. Without this window the same workspace would be emailed every
 * few minutes about the same dead Instagram connection, which trains people
 * to filter the one email that actually matters.
 */
const NOTICE_COOLDOWN_MS = 72 * 60 * 60_000;

/** How far ahead a scheduled post has to be to be worth warning about. */
export const UPCOMING_POST_WINDOW_MS = 24 * 60 * 60_000;

const MAX_RECIPIENTS = 5;
const MAX_UPCOMING_POSTS_SCANNED = 100;

export async function channelHealthEmail(params: {
  channelLabel: string;
  reason: string;
  postCount: number;
  locale: AppLocale;
}): Promise<AuthEmailPayload> {
  const t = await getEmailTranslator(params.locale);
  const title = t('channelHealth.subject', { channelLabel: params.channelLabel });
  const settingsUrl = `${getBaseUrl()}/settings`;

  const html = brandWrap({
    locale: params.locale,
    title,
    preheader: t('channelHealth.preheader', { channelLabel: params.channelLabel }),
    bodyHtml: `
      <p style="margin:0 0 16px 0;">${escapeHtml(t('channelHealth.bodyIntro', {
        channelLabel: params.channelLabel,
        count: params.postCount,
      }))}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="${BRAND.panelBg}" style="background-color:${BRAND.panelBg};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.6;color:${BRAND.ink};">${escapeHtml(params.reason)}</td>
        </tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0 0;">
        <tr>
          <td bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};border-radius:10px;">
            <a href="${settingsUrl}" style="display:inline-block;padding:12px 22px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(t('channelHealth.cta'))}</a>
          </td>
        </tr>
      </table>
    `,
    footerNote: t('channelHealth.footerNote'),
    copyrightText: t('shared.copyright', { year: new Date().getFullYear() }),
  });

  const text = [
    t('channelHealth.plain.heading', { channelLabel: params.channelLabel }),
    '',
    params.reason,
    '',
    t('channelHealth.plain.reconnectLink', { url: settingsUrl }),
  ].join('\n');

  return { subject: title, html, text };
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

/**
 * Claim the right to warn about one channel, atomically.
 *
 * A transaction rather than a read-then-write: the tick can run concurrently
 * for one workspace (the dispatcher and the legacy sweep both reach it), and
 * two instances racing here would send the same warning twice.
 */
async function claimNotice(
  workspaceId: string,
  channel: SocialChannel,
  now: Date,
): Promise<boolean> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/channelHealthNotices/${channel}`);
  return adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const lastSentAt = snapshot.data()?.lastSentAt;
    const lastSentMs = typeof lastSentAt === 'string' ? Date.parse(lastSentAt) : NaN;
    if (Number.isFinite(lastSentMs) && now.getTime() - lastSentMs < NOTICE_COOLDOWN_MS) {
      return false;
    }
    tx.set(ref, {
      channel,
      lastSentAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }, { merge: true });
    return true;
  });
}

export type ChannelHealthNoticeResult = {
  /** Channels that have upcoming posts and are not ready to publish. */
  atRisk: number;
  /** Channels an email was actually sent for (the rest were in cooldown). */
  notified: number;
};

/**
 * Warn about channels that upcoming scheduled posts depend on and cannot use.
 *
 * Deliberately scoped to channels with posts scheduled in the next 24 hours,
 * not every broken connection: a channel nobody is about to publish to is a
 * dashboard banner, not an email.
 *
 * Never throws. A failed warning must not fail the tick that found it.
 */
export async function notifyUnreadyChannelsForUpcomingPosts(
  workspaceId: string,
  now = new Date(),
): Promise<ChannelHealthNoticeResult> {
  const result: ChannelHealthNoticeResult = { atRisk: 0, notified: 0 };

  try {
    const windowEnd = new Date(now.getTime() + UPCOMING_POST_WINDOW_MS).toISOString();
    const upcoming = await adminDb
      .collection(`workspaces/${workspaceId}/posts`)
      .where('status', '==', 'scheduled')
      .orderBy('scheduledAt', 'asc')
      .limit(MAX_UPCOMING_POSTS_SCANNED)
      .get();

    // Group upcoming posts by (productId, channel): readiness is per brand,
    // so one workspace can have Instagram healthy for brand A and dead for
    // brand B, and warning about the wrong one is worse than not warning.
    const byProduct = new Map<string, { channels: Set<SocialChannel>; postCount: number }>();
    for (const doc of upcoming.docs) {
      const post = doc.data();
      const scheduledAt = typeof post.scheduledAt === 'string' ? post.scheduledAt : null;
      if (!scheduledAt || scheduledAt > windowEnd) continue;
      const productId = typeof post.productId === 'string' ? post.productId : '';
      const entry = byProduct.get(productId) ?? { channels: new Set<SocialChannel>(), postCount: 0 };
      for (const channel of getPostTargetChannels(post)) entry.channels.add(channel);
      entry.postCount += 1;
      byProduct.set(productId, entry);
    }
    if (byProduct.size === 0) return result;

    const recipients = await getRecipients(workspaceId);

    for (const [productId, entry] of byProduct) {
      const unavailable = await getUnavailableSocialChannels(
        workspaceId,
        productId || undefined,
        [...entry.channels],
      );
      result.atRisk += unavailable.length;
      if (unavailable.length === 0 || recipients.length === 0) continue;

      for (const { channel, reason } of unavailable) {
        if (!(await claimNotice(workspaceId, channel, now))) continue;

        const byLocale = new Map<AppLocale, string[]>();
        for (const { email, locale } of recipients) {
          const group = byLocale.get(locale) ?? [];
          group.push(email);
          byLocale.set(locale, group);
        }

        await Promise.all(Array.from(byLocale.entries()).map(async ([locale, emails]) => {
          const payload = await channelHealthEmail({
            channelLabel: getSocialChannelLabel(channel),
            reason,
            postCount: entry.postCount,
            locale,
          });
          await sendResendEmail({
            to: emails,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
          });
        }));

        result.notified += 1;
        logger.info('channel health warning sent', {
          event: 'channels.health_warning_sent',
          workspaceId,
          channel,
          productId: productId || null,
          upcomingPosts: entry.postCount,
        });
      }
    }
  } catch (error) {
    logger.warn('channel health warning failed', {
      event: 'channels.health_warning_failed',
      workspaceId,
      err: error,
    });
  }

  return result;
}
