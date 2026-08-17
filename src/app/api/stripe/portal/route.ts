import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe/server';
import { getSubscriptionForWorkspace } from '@/lib/stripe/subscription';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    // The portal manages the workspace's Stripe customer (cancel, change
    // plan, payment methods) — owner-only.
    requirePermission(ctx, 'billing.manage');

    // The portal must open the WORKSPACE's customer, so read the workspace
    // subscription directly — an account-level comp has no Stripe customer
    // and must not shadow it.
    const sub = await getSubscriptionForWorkspace(ctx.workspaceId);
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
    if (err instanceof Error && (err.message === 'FORBIDDEN' || err.message === 'FORBIDDEN_WORKSPACE')) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[stripe/portal]', err);
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
  }
}
