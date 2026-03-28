import { NextResponse } from 'next/server';
import { getStripe, tierFromPriceId } from '@/lib/stripe/server';
import { upsertSubscription, findUidByCustomerId, deleteSubscription } from '@/lib/stripe/subscription';
import type Stripe from 'stripe';

export async function POST(req: Request) {
  const stripe = getStripe();
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const uid = session.metadata?.firebaseUid;
        if (!uid || !session.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        await syncSubscription(uid, subscription);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const uid =
          subscription.metadata?.firebaseUid ||
          (await findUidByCustomerId(subscription.customer as string));
        if (!uid) break;

        await syncSubscription(uid, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const uid =
          subscription.metadata?.firebaseUid ||
          (await findUidByCustomerId(subscription.customer as string));
        if (!uid) break;

        await upsertSubscription(uid, {
          stripeSubscriptionId: subscription.id,
          status: 'canceled',
          cancelAtPeriodEnd: false,
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const uid = await findUidByCustomerId(customerId);
        if (!uid) break;

        await upsertSubscription(uid, { status: 'past_due' });
        break;
      }
    }
  } catch (err) {
    console.error('[stripe/webhook] Handler error:', err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function syncSubscription(uid: string, subscription: Stripe.Subscription) {
  const priceId = subscription.items.data[0]?.price?.id;
  const tierInfo = priceId ? tierFromPriceId(priceId) : null;

  const billingAnchor = subscription.billing_cycle_anchor;
  const periodEndEstimate = billingAnchor
    ? new Date(billingAnchor * 1000).toISOString()
    : new Date().toISOString();

  await upsertSubscription(uid, {
    stripeCustomerId: subscription.customer as string,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId || '',
    tier: tierInfo?.tier || 'unknown',
    interval: tierInfo?.interval || 'unknown',
    status: subscription.status,
    trialEnd: subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null,
    currentPeriodEnd: subscription.cancel_at
      ? new Date(subscription.cancel_at * 1000).toISOString()
      : periodEndEstimate,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
}
