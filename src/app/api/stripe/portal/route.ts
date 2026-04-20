import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe/server';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { requireContext } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);

    const sub = await getEffectiveSubscription({ uid: ctx.uid, workspaceId: ctx.workspaceId });
    if (!sub?.stripeCustomerId) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
    }

    const stripe = getStripe();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${appUrl}/settings`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHENTICATED') {
      return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    }
    console.error('[stripe/portal]', err);
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
  }
}
