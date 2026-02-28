import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { renderTemplate, type TemplateVars } from './templates';

type SendResult = {
  success: boolean;
  sent: number;
  failed: number;
  errors: string[];
};

type Contact = {
  id: string;
  name: string;
  email: string;
  status: string;
};

/**
 * Send an email campaign to contacts in a workspace.
 * Uses Resend API for actual delivery.
 */
export async function sendCampaignEmails(
  workspaceId: string,
  campaign: {
    name: string;
    subject?: string;
    body?: string;
    cta?: string;
    targetAudience?: string;
  },
  options: { testMode?: boolean; testEmail?: string } = {},
): Promise<SendResult> {
  // Get Resend config
  const integDoc = await adminDb
    .doc(`workspaces/${workspaceId}/integrations/resend`)
    .get();
  const cfg = integDoc.data();

  if (!cfg) {
    return { success: false, sent: 0, failed: 0, errors: ['Resend integration not configured'] };
  }

  let apiKey = '';
  if (cfg.apiKeyEncrypted) {
    apiKey = decrypt(cfg.apiKeyEncrypted);
  } else if (cfg.apiKey) {
    apiKey = String(cfg.apiKey);
  }

  const fromEmail = String(cfg.fromEmail || '');
  if (!apiKey || !fromEmail) {
    return { success: false, sent: 0, failed: 0, errors: ['Resend API key or from email not configured'] };
  }

  // Get target contacts
  let contacts: Contact[] = [];

  if (options.testMode && options.testEmail) {
    contacts = [{ id: 'test', name: 'Test User', email: options.testEmail, status: 'active' }];
  } else {
    const contactsSnap = await adminDb
      .collection(`workspaces/${workspaceId}/contacts`)
      .where('status', '==', 'active')
      .limit(500)
      .get();
    contacts = contactsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Contact));
  }

  if (contacts.length === 0) {
    return { success: true, sent: 0, failed: 0, errors: ['No active contacts to send to'] };
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  // Send emails in batches of 10
  const batchSize = 10;
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (contact) => {
        const vars: TemplateVars = {
          subject: campaign.subject || campaign.name,
          body: campaign.body || `Hi ${contact.name}, we have something exciting for you!`,
          ctaText: campaign.cta || 'Learn More',
          ctaUrl: '#',
          recipientName: contact.name,
          recipientEmail: contact.email,
          unsubscribeUrl: '#',
        };

        const html = renderTemplate(vars);

        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [contact.email],
            subject: vars.subject,
            html,
          }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(`${contact.email}: ${err.message || resp.statusText}`);
        }
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        sent++;
      } else {
        failed++;
        errors.push(r.reason?.message || 'Unknown error');
      }
    }
  }

  return { success: failed === 0, sent, failed, errors };
}
