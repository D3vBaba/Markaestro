import { NextResponse } from 'next/server';
import { getStripe, tierFromPriceId } from '@/lib/stripe/server';
import {
  upsertSubscriptionForWorkspace,
  findWorkspaceIdByCustomerId,
} from '@/lib/stripe/subscription';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
// Webhooks must not be cached or pre-rendered.
export const dynamic = 'force-dynamic';

const WEBHOOK_EVENTS_COLLECTION = 'stripeWebhookEvents';
const IDEMPOTENCY_RETENTION_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

type Subscription = Stripe.Subscription & {
  current_period_end?: number;
  current_period_start?: number;
};

/**
 * Returns true iff we have not seen this Stripe event id before.
 * Uses a Firestore transaction on `stripeWebhookEvents/{eventId}` so
 * simultaneous retries from Stripe are deduplicated atomically.
 */
async function markEventProcessedOnce(eventId: string, type: string): Promise<boolean> {
  const ref = adminDb.collection(WEBHOOK_EVENTS_COLLECTION).doc(eventId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    tx.set(ref, {
      type,
      receivedAt: new Date().toISOString(),
      // Firestore TTL consumes this field — see docs/operations/firestore-ttl.md
      expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
    });
    return true;
  });
}

function toIso(seconds?: number | null): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

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

  // Idempotency: Stripe retries with the same event.id on transient errors.
  // If we've already processed this event, ack with 200 and skip.
  let firstSeen = true;
  try {
    firstSeen = await markEventProcessedOnce(event.id, event.type);
  } catch (err) {
    // If Firestore is unreachable we'd rather let Stripe retry than
    // double-process silently, so surface a 500.
    console.error('[stripe/webhook] Idempotency check failed:', err);
    return NextResponse.json({ error: 'Idempotency check failed' }, { status: 500 });
  }
  if (!firstSeen) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const workspaceId = await resolveWorkspaceIdFromCheckout(session);
        if (!workspaceId || !session.subscription) break;

        const subscription = (await stripe.subscriptions.retrieve(
          session.subscription as string,
        )) as Subscription;
        await syncSubscription(workspaceId, subscription);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.trial_will_end':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        const subscription = event.data.object as Subscription;
        const workspaceId = await resolveWorkspaceIdFromSubscription(subscription);
        if (!workspaceId) break;
        await syncSubscription(workspaceId, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Subscription;
        const workspaceId = await resolveWorkspaceIdFromSubscription(subscription);
        if (!workspaceId) break;

        await upsertSubscriptionForWorkspace(workspaceId, {
          stripeSubscriptionId: subscription.id,
          status: 'canceled',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: toIso(subscription.current_period_end),
        });
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription };
        const subId = typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id;
        if (!subId) break;
        const subscription = (await stripe.subscriptions.retrieve(subId)) as Subscription;
        const workspaceId = await resolveWorkspaceIdFromSubscription(subscription);
        if (!workspaceId) break;
        await syncSubscription(workspaceId, subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const workspaceId = await findWorkspaceIdByCustomerId(customerId);
        if (!workspaceId) break;

        await upsertSubscriptionForWorkspace(workspaceId, { status: 'past_due' });
        break;
      }

      case 'customer.deleted': {
        const customer = event.data.object as Stripe.Customer;
        const workspaceId = await findWorkspaceIdByCustomerId(customer.id);
        if (!workspaceId) break;
        await upsertSubscriptionForWorkspace(workspaceId, { status: 'canceled', cancelAtPeriodEnd: false });
        break;
      }
    }
  } catch (err) {
    // Roll back idempotency marker so Stripe retries deliver it again.
    try {
      await adminDb.collection(WEBHOOK_EVENTS_COLLECTION).doc(event.id).delete();
    } catch {
      // best-effort
    }
    console.error('[stripe/webhook] Handler error:', err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function resolveWorkspaceIdFromSubscription(subscription: Subscription): Promise<string | null> {
  const fromMetadata = (subscription.metadata?.workspaceId as string | undefined) || null;
  if (fromMetadata) return fromMetadata;
  const fromCustomer = await findWorkspaceIdByCustomerId(subscription.customer as string);
  if (fromCustomer) return fromCustomer;
  logger.warn('stripe subscription missing workspace context', {
    event: 'stripe.webhook.unmapped_sub',
    subscriptionId: subscription.id,
    customerId: subscription.customer as string,
  });
  return null;
}

async function resolveWorkspaceIdFromCheckout(session: Stripe.Checkout.Session): Promise<string | null> {
  return (session.metadata?.workspaceId as string | undefined) || null;
}

async function syncSubscription(workspaceId: string, subscription: Subscription) {
  const priceId = subscription.items.data[0]?.price?.id;
  const tierInfo = priceId ? tierFromPriceId(priceId) : null;

  const currentPeriodEnd =
    toIso(subscription.current_period_end) ||
    toIso(subscription.billing_cycle_anchor) ||
    null;

  await upsertSubscriptionForWorkspace(workspaceId, {
    stripeCustomerId: subscription.customer as string,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId || '',
    tier: tierInfo?.tier || 'unknown',
    interval: tierInfo?.interval || 'unknown',
    status: subscription.status,
    trialEnd: toIso(subscription.trial_end),
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
}
