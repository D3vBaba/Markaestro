function brandWrap(params: { title: string; preheader?: string; bodyHtml: string }) {
  const preheader = params.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(params.preheader)}</div>` : '';
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(params.title)}</title>
  </head>
  <body style="margin:0;background:#0b0f19;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    ${preheader}
    <div style="padding:32px 12px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.35);">
        <div style="padding:22px 22px 0 22px;">
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Markaestro</div>
          <h1 style="margin:10px 0 0 0;font-size:22px;line-height:1.25;color:#111827;">${escapeHtml(params.title)}</h1>
        </div>
        <div style="padding:18px 22px 22px 22px;color:#111827;font-size:14px;line-height:1.6;">
          ${params.bodyHtml}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0;" />
          <div style="color:#6b7280;font-size:12px;line-height:1.5;">
            If you didn’t request this, you can safely ignore this email.
          </div>
        </div>
      </div>
      <div style="max-width:560px;margin:14px auto 0 auto;color:#9ca3af;font-size:12px;line-height:1.4;text-align:center;">
        © ${new Date().getFullYear()} Markaestro
      </div>
    </div>
  </body>
</html>`;
}

function ctaButton(href: string, label: string) {
  return `<a href="${escapeAttr(href)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 16px;border-radius:12px;font-weight:600;">${escapeHtml(label)}</a>`;
}

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

export function passwordResetEmail(params: { actionUrl: string; email?: string | null }) {
  const title = 'Reset your password';
  const html = brandWrap({
    title,
    preheader: 'Reset your Markaestro password.',
    bodyHtml: `
      <p>We received a request to reset the password for <strong>${escapeHtml(params.email || '')}</strong>.</p>
      <p style="margin:16px 0 18px 0;">${ctaButton(params.actionUrl, 'Reset password')}</p>
      <p style="margin:18px 0 0 0;color:#6b7280;font-size:12px;">
        If the button doesn’t work, copy and paste this link into your browser:<br/>
        <span style="word-break:break-all;">${escapeHtml(params.actionUrl)}</span>
      </p>
    `,
  });
  return { subject: 'Reset your Markaestro password', html };
}

export function verifyEmail(params: { actionUrl: string; email?: string | null }) {
  const title = 'Verify your email';
  const html = brandWrap({
    title,
    preheader: 'Confirm your email address for Markaestro.',
    bodyHtml: `
      <p>Please verify <strong>${escapeHtml(params.email || '')}</strong> to finish setting up your account.</p>
      <p style="margin:16px 0 18px 0;">${ctaButton(params.actionUrl, 'Verify email')}</p>
      <p style="margin:18px 0 0 0;color:#6b7280;font-size:12px;">
        If the button doesn’t work, copy and paste this link into your browser:<br/>
        <span style="word-break:break-all;">${escapeHtml(params.actionUrl)}</span>
      </p>
    `,
  });
  return { subject: 'Verify your email for Markaestro', html };
}

export function verifyAndChangeEmail(params: { actionUrl: string; newEmail: string }) {
  const title = 'Confirm your new email';
  const html = brandWrap({
    title,
    preheader: 'Approve your email change for Markaestro.',
    bodyHtml: `
      <p>You requested to change your Markaestro email to <strong>${escapeHtml(params.newEmail)}</strong>.</p>
      <p style="margin:16px 0 18px 0;">${ctaButton(params.actionUrl, 'Confirm email change')}</p>
      <p style="margin:18px 0 0 0;color:#6b7280;font-size:12px;">
        If the button doesn’t work, copy and paste this link into your browser:<br/>
        <span style="word-break:break-all;">${escapeHtml(params.actionUrl)}</span>
      </p>
    `,
  });
  return { subject: 'Confirm your new email for Markaestro', html };
}

export function emailChangeNotice(params: { oldEmail: string; newEmail: string }) {
  const title = 'Your email change request';
  const html = brandWrap({
    title,
    preheader: 'An email change was requested for your Markaestro account.',
    bodyHtml: `
      <p>An email change was requested for your Markaestro account:</p>
      <p style="margin:12px 0;"><strong>${escapeHtml(params.oldEmail)}</strong> → <strong>${escapeHtml(params.newEmail)}</strong></p>
      <p>If you didn’t request this, please secure your account immediately by resetting your password.</p>
    `,
  });
  return { subject: 'Email change requested for Markaestro', html };
}

