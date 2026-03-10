import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { decrypt } from '@/lib/crypto';
import { z } from 'zod';

const testSchema = z.object({
  to: z.string().trim().min(1).email('Invalid recipient email'),
  productId: z.string().trim().min(1, 'productId is required'),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const { to, productId } = testSchema.parse(body);

    const doc = await adminDb
      .doc(`workspaces/${ctx.workspaceId}/products/${productId}/integrations/resend`)
      .get();
    const cfg = doc.data() || {};

    if (!cfg.apiKeyEncrypted) {
      throw new Error('VALIDATION_MISSING_RESEND_CONFIG');
    }
    const apiKey = decrypt(cfg.apiKeyEncrypted);
    const from = String(cfg.fromEmail || '');
    if (!from) {
      throw new Error('VALIDATION_MISSING_RESEND_CONFIG');
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'Markaestro integration test',
        html: '<p>Resend integration is connected from Markaestro.</p>',
      }),
    });

    const data = await resp.json();
    return apiOk({ ok: resp.ok, status: resp.status, data });
  } catch (error) {
    return apiError(error);
  }
}
