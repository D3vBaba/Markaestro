import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getStripe, priceIdForPlan } from '@/lib/stripe/server';
import { getSubscription } from '@/lib/stripe/subscription';
import { TRIAL_DAYS } from '@/lib/stripe/plans';
import type { PlanTier, BillingInterval } from '@/lib/stripe/plans';

export async function POST(req: Request) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    const uid = decoded.uid;
    const email = decoded.email;

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

    const existing = await getSubscription(uid);
    let customerId = existing?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { firebaseUid: uid },
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
        metadata: { firebaseUid: uid, tier, interval },
      },
      success_url: `${appUrl}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/onboarding`,
      metadata: { firebaseUid: uid },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[stripe/checkout]', err);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
