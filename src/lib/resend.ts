type ResendSendEmailRequest = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

function getResendApiKey(): string {
  return (process.env.RESEND_API_KEY || '').trim();
}

function getDefaultFrom(): string {
  return (process.env.RESEND_FROM || '').trim() || 'Markaestro <no-reply@markaestro.com>';
}

export async function sendResendEmail(input: Omit<ResendSendEmailRequest, 'from'> & { from?: string }) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    throw new Error('RESEND_NOT_CONFIGURED');
  }

  const payload: ResendSendEmailRequest = {
    from: input.from?.trim() || getDefaultFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  };

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('[resend] send failed:', resp.status, body);
    throw new Error('EMAIL_SEND_FAILED');
  }

  return resp.json().catch(() => ({}));
}

