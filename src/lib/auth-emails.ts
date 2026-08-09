/**
 * Transactional HTML + plain text for auth flows delivered via Resend.
 * Table-based layout improves rendering in Gmail/Outlook; inline CSS only.
 *
 * Dark-mode rules (learned the hard way):
 * - No CSS gradients: Gmail dark mode inverts text colors but cannot recolor
 *   gradient backgrounds, which left white-on-dark headers unreadable.
 * - Solid colors everywhere, with `bgcolor` attribute fallbacks, so client
 *   dark-mode transforms keep text/background contrast coherent.
 * - The logo ships as an image with a baked-in white tile: mail clients never
 *   recolor images, so the banner brand stays bright in light AND dark mode.
 *
 * i18n: every builder takes a `locale` and renders via a next-intl
 * `createTranslator` instance (see getEmailTranslator) rather than a React
 * component — these run in API routes and background jobs with no request/
 * component tree for next-intl's usual hooks to attach to. `<html lang dir>`
 * follows the same locale so RTL locales (Arabic) render mirrored.
 */

import { createTranslator } from 'next-intl';
import { isRtlLocale, type AppLocale } from '@/i18n/routing';

export const BRAND = {
  bgPage: '#eef2f7',
  cardBg: '#ffffff',
  ink: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  accent: '#2563eb',
  panelBg: '#f8fafc',
};

export type AuthEmailPayload = {
  subject: string;
  html: string;
  text: string;
};

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function getBaseUrl(): string {
  const base =
    process.env.OAUTH_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://markaestro.com';
  return base.replace(/\/+$/, '');
}

/** A next-intl translator for the `emails` message catalog, outside of any request/component tree. */
export async function getEmailTranslator(locale: AppLocale) {
  const messages = (await import(`../messages/${locale}/emails.json`)).default;
  return createTranslator({ locale, messages });
}

/**
 * Messages with embedded `<strong>` tags must go through `t.markup()`, not
 * plain `t()` — next-intl treats ANY `<tag>` syntax as a rich-text
 * placeholder requiring a callback, and plain `t()` silently falls back to
 * returning the message key when one isn't supplied. `t.markup()` is the
 * non-React counterpart of `t.rich()`: same tag-callback API, returns a
 * plain string instead of JSX — exactly what building an HTML email needs.
 */
export const strongTag = { strong: (chunks: string) => `<strong>${chunks}</strong>` };

/**
 * Big, copy-friendly one-time code. Saturated accent on a light panel: mail
 * clients keep saturated colors through dark-mode transforms, and if the
 * panel is darkened the accent still contrasts.
 */
function codeBlock(code: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 0 0;">
    <tr>
      <td align="center" bgcolor="${BRAND.panelBg}" style="background-color:${BRAND.panelBg};border:1px solid ${BRAND.border};border-radius:14px;padding:24px 16px;">
        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:12px;color:${BRAND.accent};">${escapeHtml(code)}</span>
      </td>
    </tr>
  </table>`;
}

function footerLegal(note: string) {
  return `<p style="margin:28px 0 0 0;padding-top:22px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px;line-height:1.6;">
    ${escapeHtml(note)}
  </p>`;
}

export function brandWrap(params: {
  locale: AppLocale;
  title: string;
  preheader?: string;
  bodyHtml: string;
  footerNote: string;
  copyrightText: string;
}) {
  const dir = isRtlLocale(params.locale) ? 'rtl' : 'ltr';
  const preheader = params.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(params.preheader)}</div>`
    : '';
  const logoUrl = `${getBaseUrl()}/email/logo.png`;

  return `<!doctype html>
<html lang="${params.locale}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${escapeHtml(params.title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.bgPage};-webkit-font-smoothing:antialiased;" dir="${dir}">
    ${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BRAND.bgPage}" style="background-color:${BRAND.bgPage};padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-radius:20px;overflow:hidden;border:1px solid ${BRAND.border};">
            <tr>
              <td bgcolor="${BRAND.accent}" height="4" style="background-color:${BRAND.accent};height:4px;line-height:4px;font-size:0;">&nbsp;</td>
            </tr>
            <tr>
              <td bgcolor="${BRAND.cardBg}" style="background-color:${BRAND.cardBg};padding:26px 32px 24px 32px;border-bottom:1px solid ${BRAND.border};">
                <table role="presentation" cellpadding="0" cellspacing="0" dir="${dir}">
                  <tr>
                    <td style="vertical-align:middle;">
                      <img src="${logoUrl}" width="36" height="36" alt="Markaestro" style="display:block;width:36px;height:36px;border-radius:9px;border:1px solid ${BRAND.border};" />
                    </td>
                    <td style="vertical-align:middle;padding-${dir === 'rtl' ? 'right' : 'left'}:12px;">
                      <span style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;letter-spacing:-0.02em;color:${BRAND.ink};">Markaestro</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td bgcolor="${BRAND.cardBg}" style="background-color:${BRAND.cardBg};padding:30px 32px 32px 32px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${BRAND.ink};">
                <h1 style="margin:0 0 14px 0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:21px;font-weight:600;line-height:1.3;color:${BRAND.ink};letter-spacing:-0.02em;">
                  ${escapeHtml(params.title)}
                </h1>
                ${params.bodyHtml}
                ${footerLegal(params.footerNote)}
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0 0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">
            ${escapeHtml(params.copyrightText)}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** One-time code for signing in (also serves as email verification). */
export async function signInCodeEmail(params: { code: string; email?: string | null; locale: AppLocale }): Promise<AuthEmailPayload> {
  const t = await getEmailTranslator(params.locale);
  const email = params.email || t('signInCode.fallbackAccount');
  const title = t('signInCode.title');
  const html = brandWrap({
    locale: params.locale,
    title,
    preheader: t('signInCode.preheader', { code: params.code }),
    bodyHtml: `
      <p style="margin:0 0 16px 0;">${t.markup('signInCode.bodyIntro', { email: escapeHtml(email), ...strongTag })}</p>
      ${codeBlock(params.code)}
      <p style="margin:18px 0 0 0;color:${BRAND.muted};font-size:13px;">${escapeHtml(t('signInCode.expiryNote'))}</p>
    `,
    footerNote: t('signInCode.footerNote'),
    copyrightText: t('shared.copyright', { year: new Date().getFullYear() }),
  });
  const text = [
    t('signInCode.plain.heading'),
    '',
    t('signInCode.plain.codeLabel', { code: params.code }),
    '',
    t('signInCode.plain.expiry'),
    t('signInCode.plain.footer'),
  ].join('\n');
  return { subject: t('signInCode.subject', { code: params.code }), html, text };
}

/** One-time code sent to the NEW address to confirm an email change. */
export async function emailChangeCodeEmail(params: { code: string; newEmail: string; locale: AppLocale }): Promise<AuthEmailPayload> {
  const t = await getEmailTranslator(params.locale);
  const title = t('emailChangeCode.title');
  const html = brandWrap({
    locale: params.locale,
    title,
    preheader: t('emailChangeCode.preheader', { code: params.code }),
    bodyHtml: `
      <p style="margin:0 0 16px 0;">${t.markup('emailChangeCode.bodyIntro', { newEmail: escapeHtml(params.newEmail), ...strongTag })}</p>
      ${codeBlock(params.code)}
      <p style="margin:18px 0 0 0;color:${BRAND.muted};font-size:13px;">${escapeHtml(t('emailChangeCode.expiryNote'))}</p>
    `,
    footerNote: t('emailChangeCode.footerNote'),
    copyrightText: t('shared.copyright', { year: new Date().getFullYear() }),
  });
  const text = [
    t('emailChangeCode.plain.heading'),
    '',
    t('emailChangeCode.plain.newEmailLabel', { newEmail: params.newEmail }),
    t('emailChangeCode.plain.codeLabel', { code: params.code }),
    '',
    t('emailChangeCode.plain.expiry'),
    t('emailChangeCode.plain.footer'),
  ].join('\n');
  return { subject: t('emailChangeCode.subject', { code: params.code }), html, text };
}

/** Heads-up to the OLD address when an email change is requested. */
export async function emailChangeNotice(params: { oldEmail: string; newEmail: string; locale: AppLocale }): Promise<AuthEmailPayload> {
  const t = await getEmailTranslator(params.locale);
  const title = t('emailChangeNotice.title');
  const html = brandWrap({
    locale: params.locale,
    title,
    preheader: t('emailChangeNotice.preheader'),
    bodyHtml: `
      <p style="margin:0 0 16px 0;">${escapeHtml(t('emailChangeNotice.bodyIntro'))}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="${BRAND.panelBg}" style="background-color:${BRAND.panelBg};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 18px;font-size:14px;color:${BRAND.ink};">
            <span style="color:${BRAND.muted};font-size:12px;display:block;margin-bottom:6px;">${escapeHtml(t('emailChangeNotice.fromToLabel'))}</span>
            ${t.markup('emailChangeNotice.changeSummary', { oldEmail: escapeHtml(params.oldEmail), newEmail: escapeHtml(params.newEmail), ...strongTag })}
          </td>
        </tr>
      </table>
      <p style="margin:22px 0 0 0;color:${BRAND.muted};font-size:14px;">${t.markup('emailChangeNotice.bodyOutro', strongTag)}</p>
    `,
    footerNote: t('emailChangeNotice.footerNote'),
    copyrightText: t('shared.copyright', { year: new Date().getFullYear() }),
  });
  const text = [
    t('emailChangeNotice.plain.heading'),
    '',
    t('emailChangeNotice.plain.changeSummary', { oldEmail: params.oldEmail, newEmail: params.newEmail }),
    '',
    t('emailChangeNotice.plain.warning'),
  ].join('\n');
  return { subject: t('emailChangeNotice.subject'), html, text };
}
