import { NextResponse } from 'next/server';
import { getStripe, hasStripeCustomer, resolvePlanPrice } from '@/lib/stripe/server';
import { getSubscriptionForWorkspace } from '@/lib/stripe/subscription';
import { TRIAL_DAYS, PLAN_TIERS, type PlanTier, type BillingInterval } from '@/lib/stripe/plans';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { safeInternalPathOrNull } from '@/lib/safe-internal-path';

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
    // Billing is owner-only: checkout changes the workspace's paid plan.
    requirePermission(ctx, 'billing.manage');
    const uid = ctx.uid;
    const workspaceId = ctx.workspaceId;
    const email = ctx.email || null;

    const body = await req.json();
    const tier = body.tier as PlanTier;
    const interval = (body.interval || 'annual') as BillingInterval;
    // Where the user pressed "upgrade". Untrusted input, so it is validated as
    // an internal path; null means the caller named no origin.
    const requestedReturnTo = safeInternalPathOrNull(
      typeof body.returnTo === 'string' ? body.returnTo : null,
      { selfPrefix: '/onboarding/success' },
    );

    if (!PLAN_TIERS.includes(tier)) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
    }
    if (!['monthly', 'annual'].includes(interval)) {
      return NextResponse.json({ error: 'Invalid interval' }, { status: 400 });
    }

    const stripe = getStripe();

    // Verified against Stripe rather than trusted from env — an archived price
    // in STRIPE_PRICE_* fails checkout with "The price specified is inactive",
    // which surfaces as a 500 and reads as a broken payment integration.
    const resolved = await resolvePlanPrice(stripe, tier, interval);
    if (!resolved.ok) {
      console.error('[stripe/checkout] no usable price', { tier, interval, reason: resolved.reason });
      return NextResponse.json(
        { error: resolved.reason === 'NOT_CONFIGURED' ? 'Price not configured' : 'Price unavailable' },
        { status: 500 },
      );
    }
    if (resolved.substituted) {
      console.error('[stripe/checkout] STRIPE_PRICE config is stale', {
        tier,
        interval,
        using: resolved.priceId,
        hint: 'update STRIPE_PRICE_* in apphosting.yaml to the active price id',
      });
    }
    const priceId = resolved.priceId;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Backing out returns exactly where the user was — without this, cancelling
    // an upgrade started in Settings dropped them into the onboarding quiz.
    // Paying continues forward instead, which only differs for onboarding:
    // finishing the funnel lands in the app, not back on the paywall.
    const cancelPath = requestedReturnTo ?? '/onboarding';
    const portalReturn = requestedReturnTo ?? '/settings';
    const successNext =
      requestedReturnTo && !requestedReturnTo.startsWith('/onboarding')
        ? requestedReturnTo
        : '/dashboard';

    const existing = await getSubscriptionForWorkspace(workspaceId);

    // The workspace already has a live subscription: never stack a second
    // Stripe subscription on top of it. Send the owner to the billing portal
    // instead (mirrors /api/stripe/portal), where plan changes go through
    // Stripe with correct proration. Manual grants carry a placeholder
    // customer id the portal rejects — those fall through to a real checkout.
    if (existing && ['active', 'trialing'].includes(existing.status) && hasStripeCustomer(existing)) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: existing.stripeCustomerId,
        return_url: `${appUrl}${portalReturn}`,
      });
      return NextResponse.json({ url: portal.url });
    }

    let customerId = hasStripeCustomer(existing) ? existing.stripeCustomerId : undefined;

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

    // One trial per customer, ever. A trial is granted only when the
    // workspace has never had a subscription document (any status — a
    // canceled record still counts as history) AND the Stripe customer has
    // no subscription history either. The second check matters because
    // customers are reused across re-signups by email, so a fresh workspace
    // can still be attached to a customer that already burned its trial.
    let trialEligible = !existing;
    if (trialEligible) {
      const priorSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 1,
      });
      trialEligible = priorSubscriptions.data.length === 0;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        ...(trialEligible ? { trial_period_days: TRIAL_DAYS } : {}),
        // workspaceId is the primary billing key — the webhook resolves
        // subscriptions back to Firestore via this field first, falling
        // back to the customer mapping if absent.
        metadata: { workspaceId, firebaseUid: uid, tier, interval },
      },
      // The success page polls until the webhook lands, then follows `next`.
      success_url: `${appUrl}/onboarding/success?session_id={CHECKOUT_SESSION_ID}&next=${encodeURIComponent(successNext)}`,
      cancel_url: `${appUrl}${cancelPath}`,
      metadata: { workspaceId, firebaseUid: uid },
      allow_promotion_codes: true,
    }, {
      idempotencyKey: `checkout_${workspaceId}_${priceId}_${Math.floor(Date.now() / 60_000)}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHENTICATED') {
      return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (err instanceof Error && (err.message === 'FORBIDDEN' || err.message === 'FORBIDDEN_WORKSPACE')) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[stripe/checkout]', err);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
