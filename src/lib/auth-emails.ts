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
 */

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

export function brandWrap(params: { title: string; preheader?: string; bodyHtml: string; footerNote?: string }) {
  const preheader = params.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(params.preheader)}</div>`
    : '';
  const logoUrl = `${getBaseUrl()}/email/logo.png`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${escapeHtml(params.title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.bgPage};-webkit-font-smoothing:antialiased;">
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
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <img src="${logoUrl}" width="36" height="36" alt="Markaestro" style="display:block;width:36px;height:36px;border-radius:9px;border:1px solid ${BRAND.border};" />
                    </td>
                    <td style="vertical-align:middle;padding-left:12px;">
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
                ${footerLegal(params.footerNote || 'If you did not request this email, you can ignore it. Your account will stay unchanged.')}
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0 0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">
            © ${new Date().getFullYear()} Markaestro · Growth workflows, one place
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** One-time code for signing in (also serves as email verification). */
export function signInCodeEmail(params: { code: string; email?: string | null }): AuthEmailPayload {
  const title = 'Your sign-in code';
  const html = brandWrap({
    title,
    preheader: `${params.code} is your Markaestro sign-in code.`,
    bodyHtml: `
      <p style="margin:0 0 16px 0;">Use this code to sign in as <strong>${escapeHtml(params.email || 'your account')}</strong>:</p>
      ${codeBlock(params.code)}
      <p style="margin:18px 0 0 0;color:${BRAND.muted};font-size:13px;">The code expires in 10 minutes. Never share it with anyone — Markaestro will never ask you for it.</p>
    `,
    footerNote: 'If you did not try to sign in, you can ignore this email. Without the code, no one can access your account.',
  });
  const text = [
    'Your Markaestro sign-in code',
    '',
    `Code: ${params.code}`,
    '',
    'The code expires in 10 minutes. Never share it with anyone.',
    'If you did not try to sign in, you can ignore this email.',
  ].join('\n');
  return { subject: `${params.code} is your Markaestro sign-in code`, html, text };
}

/** One-time code sent to the NEW address to confirm an email change. */
export function emailChangeCodeEmail(params: { code: string; newEmail: string }): AuthEmailPayload {
  const title = 'Confirm your new email';
  const html = brandWrap({
    title,
    preheader: `${params.code} is your code to confirm this email change.`,
    bodyHtml: `
      <p style="margin:0 0 16px 0;">You requested to change your Markaestro email to <strong>${escapeHtml(params.newEmail)}</strong>. Enter this code in the app to confirm:</p>
      ${codeBlock(params.code)}
      <p style="margin:18px 0 0 0;color:${BRAND.muted};font-size:13px;">The code expires in 10 minutes. Never share it with anyone.</p>
    `,
    footerNote: 'If you did not request this change, you can ignore this email and your address will stay the same.',
  });
  const text = [
    'Confirm your new Markaestro email',
    '',
    `New email: ${params.newEmail}`,
    `Code: ${params.code}`,
    '',
    'The code expires in 10 minutes.',
    'If you did not request this change, you can ignore this email.',
  ].join('\n');
  return { subject: `${params.code} is your code to confirm your new Markaestro email`, html, text };
}

/** Heads-up to the OLD address when an email change is requested. */
export function emailChangeNotice(params: { oldEmail: string; newEmail: string }): AuthEmailPayload {
  const title = 'Email change requested';
  const html = brandWrap({
    title,
    preheader: 'A Markaestro email change was requested.',
    bodyHtml: `
      <p style="margin:0 0 16px 0;">Someone requested to change the email on this Markaestro account:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="${BRAND.panelBg}" style="background-color:${BRAND.panelBg};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 18px;font-size:14px;color:${BRAND.ink};">
            <span style="color:${BRAND.muted};font-size:12px;display:block;margin-bottom:6px;">From &rarr; To</span>
            <strong>${escapeHtml(params.oldEmail)}</strong>
            <span style="color:${BRAND.muted};"> &rarr; </span>
            <strong>${escapeHtml(params.newEmail)}</strong>
          </td>
        </tr>
      </table>
      <p style="margin:22px 0 0 0;color:${BRAND.muted};font-size:14px;">If this was you, complete the confirmation with the code we sent to the <strong>new address</strong>. If this was not you, your email has not changed — but please contact support right away.</p>
    `,
    footerNote: 'This notice was sent because a change was requested for your account.',
  });
  const text = [
    'Email change requested on Markaestro',
    '',
    `${params.oldEmail} -> ${params.newEmail}`,
    '',
    'If this was not you, your email has not changed — contact support right away.',
  ].join('\n');
  return { subject: 'Email change requested · Markaestro', html, text };
}
