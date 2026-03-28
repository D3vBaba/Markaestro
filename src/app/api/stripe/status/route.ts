import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getSubscription, resolveStatus } from '@/lib/stripe/subscription';

export async function GET(req: Request) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    const sub = await getSubscription(decoded.uid);
    const status = resolveStatus(sub);

    return NextResponse.json(status);
  } catch (err) {
    console.error('[stripe/status]', err);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
