import { adminDb } from '@/lib/firebase-admin';
import { sendResendEmail } from '@/lib/resend';
import { BRAND, brandWrap, escapeHtml, getBaseUrl, getEmailTranslator } from '@/lib/auth-emails';
import { isAppLocale, routing, type AppLocale } from '@/i18n/routing';
import { logger } from '@/lib/logger';
import { loadProductIntelligence } from './product-state';
import { weeklyPulse, type WeeklyPulse } from './pulse';

const RUN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECIPIENTS = 5;

export type DigestBrand = {
  productId: string;
  name: string;
  metric: string;
  pulse: WeeklyPulse;
  move: string | null;
  window: string | null;
};

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

function deltaText(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value > 0 ? '+' : ''}${value}%`;
}

function count(value: number | null): string {
  return value === null ? 'n/a' : value.toLocaleString('en-US');
}

export async function buildDigestBrands(workspaceId: string, now = new Date()): Promise<DigestBrand[]> {
  const products = await adminDb.collection(`workspaces/${workspaceId}/products`).limit(100).get();
  const brands: DigestBrand[] = [];
  for (const product of products.docs) {
    try {
      const loaded = await loadProductIntelligence(workspaceId, product.id, { allowCached: true });
      const { insights } = loaded;
      const pulse = weeklyPulse(insights.rollup.measuredPosts, now);
      if (pulse.thisWeek.posts === 0 && pulse.lastWeek.posts === 0) continue;
      const move = insights.opportunities.find((o) => o.status !== 'dismissed');
      const window = insights.timing?.windows?.[0];
      brands.push({
        productId: product.id,
        name: String(product.data()?.name ?? 'Untitled brand'),
        metric: insights.objective.metric,
        pulse,
        move: move ? move.title : null,
        window: window && window.label === 'measured' ? `${window.weekday} ${window.hour}:00` : null,
      });
    } catch (error) {
      logger.warn('weekly digest skipped a brand', { event: 'intelligence.digest.brand_failed', workspaceId, productId: product.id, err: error });
    }
  }
  return brands;
}

export async function weeklyDigestEmail(brands: DigestBrand[], locale: AppLocale) {
  const t = await getEmailTranslator(locale);
  const title = t('intelligenceDigest.subject');
  const url = `${getBaseUrl()}/intelligence`;
  const cell = (text: string, align: 'left' | 'right' = 'left') =>
    `<td align="${align}" style="padding:6px 0;font-size:13px;line-height:1.5;color:${BRAND.ink};">${text}</td>`;
  const sections = brands.map((brand) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">
        <tr>
          <td bgcolor="${BRAND.panelBg}" style="background-color:${BRAND.panelBg};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 18px;">
            <p style="margin:0 0 8px 0;font-size:15px;font-weight:600;color:${BRAND.ink};">${escapeHtml(brand.name)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>${cell(escapeHtml(t('intelligenceDigest.posts')))}${cell(count(brand.pulse.thisWeek.posts), 'right')}${cell(deltaText(brand.pulse.delta.posts), 'right')}</tr>
              <tr>${cell(escapeHtml(t('intelligenceDigest.views')))}${cell(count(brand.pulse.thisWeek.views), 'right')}${cell(deltaText(brand.pulse.delta.views), 'right')}</tr>
              <tr>${cell(escapeHtml(t('intelligenceDigest.engagements')))}${cell(count(brand.pulse.thisWeek.engagements), 'right')}${cell(deltaText(brand.pulse.delta.engagements), 'right')}</tr>
            </table>
            ${brand.move ? `<p style="margin:12px 0 0 0;font-size:13px;line-height:1.5;color:${BRAND.ink};"><strong>${escapeHtml(t('intelligenceDigest.move'))}</strong> ${escapeHtml(brand.move)}</p>` : ''}
            ${brand.window ? `<p style="margin:6px 0 0 0;font-size:13px;line-height:1.5;color:${BRAND.ink};"><strong>${escapeHtml(t('intelligenceDigest.window'))}</strong> ${escapeHtml(brand.window)}</p>` : ''}
          </td>
        </tr>
      </table>`).join('');

  const html = brandWrap({
    locale,
    title,
    preheader: t('intelligenceDigest.preheader'),
    bodyHtml: `
      <p style="margin:0 0 16px 0;">${escapeHtml(t('intelligenceDigest.intro'))}</p>
      ${sections}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0 0;">
        <tr>
          <td bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};border-radius:10px;">
            <a href="${url}" style="display:inline-block;padding:12px 22px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(t('intelligenceDigest.cta'))}</a>
          </td>
        </tr>
      </table>
    `,
    footerNote: t('intelligenceDigest.footerNote'),
    copyrightText: t('shared.copyright', { year: new Date().getFullYear() }),
  });

  const text = [
    t('intelligenceDigest.intro'),
    '',
    ...brands.map((brand) => `${brand.name}: ${count(brand.pulse.thisWeek.posts)} posts (${deltaText(brand.pulse.delta.posts)}), ${count(brand.pulse.thisWeek.views)} views (${deltaText(brand.pulse.delta.views)}), ${count(brand.pulse.thisWeek.engagements)} engagements (${deltaText(brand.pulse.delta.engagements)})${brand.move ? `. ${t('intelligenceDigest.move')} ${brand.move}` : ''}`),
    '',
    url,
  ].join('\n');

  return { subject: title, html, text };
}

/** Once a week, mail owners and admins the numbers and the one move to make. */
export async function sendIntelligenceWeeklyDigest(workspaceId: string, now = new Date()): Promise<{ sent: number; skipped: boolean }> {
  const stateRef = adminDb.doc(`workspaces/${workspaceId}/intelligenceState/digest`);
  const state = await stateRef.get();
  const lastRunAt = state.exists ? Date.parse(String(state.data()?.lastRunAt ?? '')) : Number.NaN;
  if (Number.isFinite(lastRunAt) && now.getTime() - lastRunAt < RUN_INTERVAL_MS) return { sent: 0, skipped: true };
  await stateRef.set({ lastRunAt: now.toISOString() }, { merge: true });

  const [brands, recipients] = await Promise.all([buildDigestBrands(workspaceId, now), getRecipients(workspaceId)]);
  if (brands.length === 0 || recipients.length === 0) return { sent: 0, skipped: false };

  let sent = 0;
  for (const recipient of recipients) {
    try {
      const payload = await weeklyDigestEmail(brands, recipient.locale);
      await sendResendEmail({ to: [recipient.email], subject: payload.subject, html: payload.html, text: payload.text });
      sent += 1;
    } catch (error) {
      logger.warn('weekly digest email failed', { event: 'intelligence.digest.send_failed', workspaceId, err: error });
    }
  }
  return { sent, skipped: false };
}
