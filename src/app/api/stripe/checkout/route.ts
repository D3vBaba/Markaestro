import { NextResponse } from 'next/server';
import { getStripe, priceIdForPlan } from '@/lib/stripe/server';
import { getSubscriptionForWorkspace } from '@/lib/stripe/subscription';
import { TRIAL_DAYS } from '@/lib/stripe/plans';
import type { PlanTier, BillingInterval } from '@/lib/stripe/plans';
import { requireContext } from '@/lib/server-auth';

export const runtime = 'nodejs';

async function findCustomerForWorkspace(
  stripe: ReturnType<typeof getStripe>,
  opts: { email: string | null; workspaceId: string; firebaseUid: string },
): Promise<string | null> {
  const { email, workspaceId, firebaseUid } = opts;
  if (!email) return null;

  // Look up by email: reuses existing customers across re-signups and lets
  // us attach the workspaceId metadata so subsequent webhooks can route
  // events to the right Firestore doc.
  const existing = await stripe.customers.list({ email, limit: 20 });
  if (existing.data.length === 0) return null;

  const exactWs = existing.data.find((c) => c.metadata?.workspaceId === workspaceId);
  if (exactWs) return exactWs.id;

  // Backfill metadata on the most recent customer for this email.
  const candidate = existing.data[0];
  await stripe.customers.update(candidate.id, {
    metadata: {
      ...(candidate.metadata || {}),
      workspaceId,
      firebaseUid,
    },
  });
  return candidate.id;
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const uid = ctx.uid;
    const workspaceId = ctx.workspaceId;
    const email = ctx.email || null;

    const body = await req.json();
    const tier = body.tier as PlanTier;
    const interval = (body.interval || 'annual') as BillingInterval;

    if (!['starter', 'pro', 'business'].includes(tier)) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
    }
    if (!['monthly', 'annual'].includes(interval)) {
      return NextResponse.json({ error: 'Invalid interval' }, { status: 400 });
    }

    const priceId = priceIdForPlan(tier, interval);
    if (!priceId) {
      return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
    }

    const stripe = getStripe();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const existing = await getSubscriptionForWorkspace(workspaceId);
    let customerId = existing?.stripeCustomerId;

    if (!customerId) {
      customerId = (await findCustomerForWorkspace(stripe, { email, workspaceId, firebaseUid: uid })) || undefined;
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { workspaceId, firebaseUid: uid },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        // workspaceId is the primary billing key — the webhook resolves
        // subscriptions back to Firestore via this field first, falling
        // back to the customer mapping if absent.
        metadata: { workspaceId, firebaseUid: uid, tier, interval },
      },
      success_url: `${appUrl}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/onboarding`,
      metadata: { workspaceId, firebaseUid: uid },
      allow_promotion_codes: true,
    }, {
      idempotencyKey: `checkout_${workspaceId}_${priceId}_${Math.floor(Date.now() / 60_000)}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[stripe/checkout]', err);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
