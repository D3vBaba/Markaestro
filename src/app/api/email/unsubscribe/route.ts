import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';

/**
 * GET /api/email/unsubscribe?ws=...&email=...&token=...
 * One-click unsubscribe handler (CAN-SPAM / GDPR compliant).
 * Marks the contact as unsubscribed and redirects to a confirmation page.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('ws');
  const email = url.searchParams.get('email');
  const token = url.searchParams.get('token');

  if (!workspaceId || !email || !token) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  // Verify the HMAC token
  try {
    if (!verifyUnsubscribeToken(workspaceId, email, token)) {
      return NextResponse.json({ error: 'Invalid unsubscribe link' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid unsubscribe link' }, { status: 403 });
  }

  // Find the contact by email and mark as unsubscribed
  const contactsRef = adminDb.collection(`workspaces/${workspaceId}/contacts`);
  const snap = await contactsRef.where('email', '==', email).limit(1).get();

  if (!snap.empty) {
    const contactDoc = snap.docs[0];
    await contactDoc.ref.update({
      status: 'unsubscribed',
      unsubscribedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Redirect to the confirmation page
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return NextResponse.redirect(`${baseUrl}/unsubscribe?success=true`);
}

/**
 * POST /api/email/unsubscribe
 * RFC 8058 List-Unsubscribe-Post handler for one-click email client unsubscribe.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const params = new URLSearchParams(body);

  // RFC 8058 requires List-Unsubscribe=One-Click in the POST body
  if (params.get('List-Unsubscribe') !== 'One-Click') {
    // Fall back to query params from the URL
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('ws');
    const email = url.searchParams.get('email');
    const token = url.searchParams.get('token');

    if (!workspaceId || !email || !token) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    try {
      if (!verifyUnsubscribeToken(workspaceId, email, token)) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }

    const contactsRef = adminDb.collection(`workspaces/${workspaceId}/contacts`);
    const snap = await contactsRef.where('email', '==', email).limit(1).get();
    if (!snap.empty) {
      await snap.docs[0].ref.update({
        status: 'unsubscribed',
        unsubscribedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({ ok: true });
}
