/**
 * Transactional HTML + plain text for Firebase auth flows delivered via Resend.
 * Table-based layout improves rendering in Gmail/Outlook; inline CSS only.
 */

const BRAND = {
  bgPage: '#f1f5f9',
  cardBg: '#ffffff',
  ink: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  accent: '#2563eb',
  headerBg: 'linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #0f172a 100%)',
};

export type AuthEmailPayload = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}

function ctaButton(href: string, label: string) {
  return `<a href="${escapeAttr(href)}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:9999px;font-weight:600;font-size:15px;letter-spacing:0.01em;box-shadow:0 4px 14px rgba(37,99,235,0.35);">${escapeHtml(label)}</a>`;
}

function linkFallback(url: string) {
  return `<p style="margin:20px 0 0 0;color:${BRAND.muted};font-size:12px;line-height:1.6;">
    Button not working? Copy this link into your browser:<br/>
    <span style="display:block;margin-top:8px;padding:12px 14px;background:#f8fafc;border:1px solid ${BRAND.border};border-radius:10px;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;color:${BRAND.ink};">${escapeHtml(url)}</span>
  </p>`;
}

function footerLegal() {
  return `<p style="margin:28px 0 0 0;padding-top:22px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px;line-height:1.6;">
    If you did not request this email, you can ignore it. Your account will stay unchanged.
  </p>`;
}

function brandWrap(params: { title: string; preheader?: string; bodyHtml: string }) {
  const preheader = params.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(params.preheader)}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(params.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.bgPage};-webkit-font-smoothing:antialiased;">
    ${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bgPage};padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.cardBg};border-radius:20px;overflow:hidden;border:1px solid ${BRAND.border};box-shadow:0 25px 50px -12px rgba(15,23,42,0.12);">
            <tr>
              <td style="background:${BRAND.headerBg};padding:28px 32px 26px 32px;text-align:center;">
                <div style="display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);margin-bottom:14px;">
                  <span style="font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.75);">Markaestro</span>
                </div>
                <h1 style="margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:600;line-height:1.3;color:#ffffff;letter-spacing:-0.02em;">
                  ${escapeHtml(params.title)}
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 32px 32px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${BRAND.ink};">
                ${params.bodyHtml}
                ${footerLegal()}
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

export function passwordResetEmail(params: { actionUrl: string; email?: string | null }): AuthEmailPayload {
  const title = 'Reset your password';
  const html = brandWrap({
    title,
    preheader: 'Reset your Markaestro password in one tap.',
    bodyHtml: `
      <p style="margin:0 0 16px 0;">We received a request to reset the password for <strong>${escapeHtml(params.email || 'your account')}</strong>.</p>
      <p style="margin:0 0 22px 0;color:${BRAND.muted};font-size:14px;">Use the button below to choose a new password. This link expires for your security.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr><td style="text-align:center;">${ctaButton(params.actionUrl, 'Reset password')}</td></tr>
      </table>
      ${linkFallback(params.actionUrl)}
    `,
  });
  const text = [
    'Reset your Markaestro password',
    '',
    `We received a request to reset the password for ${params.email || 'your account'}.`,
    '',
    `Open this link to continue: ${params.actionUrl}`,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');
  return { subject: 'Reset your Markaestro password', html, text };
}

export function verifyEmail(params: { actionUrl: string; email?: string | null }): AuthEmailPayload {
  const title = 'Confirm your email';
  const html = brandWrap({
    title,
    preheader: 'Verify your email to finish securing your Markaestro account.',
    bodyHtml: `
      <p style="margin:0 0 16px 0;">Please confirm <strong>${escapeHtml(params.email || 'your email address')}</strong> so we can keep your workspace and billing secure.</p>
      <p style="margin:0 0 22px 0;color:${BRAND.muted};font-size:14px;">One tap is all it takes.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr><td style="text-align:center;">${ctaButton(params.actionUrl, 'Verify email')}</td></tr>
      </table>
      ${linkFallback(params.actionUrl)}
    `,
  });
  const text = [
    'Confirm your email for Markaestro',
    '',
    `Verify: ${params.actionUrl}`,
    '',
    'If you did not create an account, you can ignore this email.',
  ].join('\n');
  return { subject: 'Confirm your email for Markaestro', html, text };
}

export function verifyAndChangeEmail(params: { actionUrl: string; newEmail: string }): AuthEmailPayload {
  const title = 'Confirm your new email';
  const html = brandWrap({
    title,
    preheader: 'Approve your Markaestro email change.',
    bodyHtml: `
      <p style="margin:0 0 16px 0;">You requested to change your Markaestro email to <strong>${escapeHtml(params.newEmail)}</strong>.</p>
      <p style="margin:0 0 22px 0;color:${BRAND.muted};font-size:14px;">Confirm this change to keep signing in without interruption.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr><td style="text-align:center;">${ctaButton(params.actionUrl, 'Confirm new email')}</td></tr>
      </table>
      ${linkFallback(params.actionUrl)}
    `,
  });
  const text = [
    'Confirm your new Markaestro email',
    '',
    `New email: ${params.newEmail}`,
    '',
    `Confirm: ${params.actionUrl}`,
  ].join('\n');
  return { subject: 'Confirm your new email for Markaestro', html, text };
}

export function emailChangeNotice(params: { oldEmail: string; newEmail: string }): AuthEmailPayload {
  const title = 'Email change requested';
  const html = brandWrap({
    title,
    preheader: 'A Markaestro email change was requested.',
    bodyHtml: `
      <p style="margin:0 0 16px 0;">Someone requested to change the email on this Markaestro account:</p>
      <p style="margin:0 0 22px 0;padding:16px 18px;background:#f8fafc;border:1px solid ${BRAND.border};border-radius:12px;font-size:14px;">
        <span style="color:${BRAND.muted};font-size:12px;display:block;margin-bottom:6px;">From → To</span>
        <strong>${escapeHtml(params.oldEmail)}</strong>
        <span style="color:${BRAND.muted};"> → </span>
        <strong>${escapeHtml(params.newEmail)}</strong>
      </p>
      <p style="margin:0;color:${BRAND.muted};font-size:14px;">If this was you, no action is needed on this email — complete the confirmation on the <strong>new address</strong>. If this was not you, reset your password and contact support.</p>
    `,
  });
  const text = [
    'Email change requested on Markaestro',
    '',
    `${params.oldEmail} → ${params.newEmail}`,
    '',
    'If this was not you, reset your password and contact support.',
  ].join('\n');
  return { subject: 'Email change requested · Markaestro', html, text };
}
