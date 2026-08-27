import { after, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { appendClickId, createClickId } from '@/lib/intelligence/conversions';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const snapshot = await adminDb.doc(`trackedLinks/${code}`).get();
  if (!snapshot.exists || snapshot.data()?.active === false) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const data = snapshot.data()!;
  let destination: string;
  const clickId = createClickId();
  try {
    destination = appendClickId(String(data.destination), clickId);
  } catch {
    return NextResponse.json({ error: 'INVALID_DESTINATION' }, { status: 410 });
  }
  const clickedAt = new Date().toISOString();
  after(async () => {
    await adminDb.doc(`conversionClicks/${clickId}`).set({
      clickId,
      workspaceId: data.workspaceId,
      productId: data.productId,
      campaignId: data.campaignId || null,
      socialPostId: data.socialPostId || null,
      trackedLinkCode: code,
      clickedAt,
      expiresAt: new Date(Date.parse(clickedAt) + 90 * 24 * 60 * 60_000),
      consentState: req.headers.get('sec-gpc') === '1' ? 'limited' : 'unknown',
      // Deliberately no raw IP, user-agent, or referrer.
    });
  });
  return NextResponse.redirect(destination, 302);
}
