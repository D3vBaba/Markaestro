import { NextResponse } from 'next/server';
import {
  getStripe,
  hasStripeCustomer,
  resolvePlanPrice,
  tierFromPriceId,
  type SubscriptionRecord,
} from '@/lib/stripe/server';
import {
  getSubscriptionForWorkspace,
  upsertSubscriptionForWorkspace,
} from '@/lib/stripe/subscription';
import { ADDONS, PLANS, PLAN_TIERS, type AddonKey, type BillingInterval, type PlanTier } from '@/lib/stripe/plans';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';

export const runtime = 'nodejs';

/** Derived from PLAN_TIERS order; anything else ranks below all purchasable tiers. */
const TIER_RANK: Record<string, number> = Object.fromEntries(
  PLAN_TIERS.map((tier, idx) => [tier, idx + 1]),
);

/** Add-ons the workspace holds that the target tier cannot carry. */
function blockedAddons(sub: SubscriptionRecord, target: PlanTier): AddonKey[] {
  const held: Record<AddonKey, number> = {
    brand: Math.max(0, sub.addonBrands ?? 0),
    seat: Math.max(0, sub.addonSeats ?? 0),
  };
  return (Object.keys(ADDONS) as AddonKey[]).filter(
    (key) => held[key] > 0 && !ADDONS[key].availableOn.includes(target),
  );
}

/**
 * The limits the workspace would have on the target tier: base plan plus the
 * add-on quantities that survive the switch (blockedAddons already 409'd any
 * add-on the target tier can't carry, so surviving quantities apply as-is).
 */
function targetLimits(target: PlanTier, sub: SubscriptionRecord) {
  const base = PLANS[target].limits;
  const addonBrands = ADDONS.brand.availableOn.includes(target) ? Math.max(0, sub.addonBrands ?? 0) : 0;
  const addonSeats = ADDONS.seat.availableOn.includes(target) ? Math.max(0, sub.addonSeats ?? 0) : 0;
  return {
    brands: base.brands === -1 ? -1 : base.brands + addonBrands,
    teamMembers: base.teamMembers === -1 ? -1 : base.teamMembers + addonSeats,
    workspaces: base.workspaces,
  };
}

/**
 * Current usage on the dimensions a downgrade can strand, counted the same
 * way the creation endpoints enforce them:
 * - brands: products in the workspace (POST /api/products);
 * - teamMembers: members plus pending invites (POST /api/team counts both
 *   toward the seat cap);
 * - workspaces: workspaces the user owns (POST /api/workspaces).
 */
async function countUsage(uid: string, workspaceId: string) {
  const [productsSnap, membersSnap, invitesSnap, ownedSnap] = await Promise.all([
    adminDb.collection(workspaceCollection(workspaceId, 'products')).count().get(),
    adminDb.collection(`workspaces/${workspaceId}/members`).count().get(),
    adminDb.collection(`workspaces/${workspaceId}/pendingInvites`).count().get(),
    adminDb.collectionGroup('members')
      .where('uid', '==', uid)
      .where('role', '==', 'owner')
      .count()
      .get(),
  ]);
  return {
    brands: productsSnap.data().count,
    teamMembers: membersSnap.data().count + invitesSnap.data().count,
    workspaces: ownedSnap.data().count,
  };
}

type UsageDimension = 'brands' | 'teamMembers' | 'workspaces';

/** POST /api/stripe/change-plan { tier: 'starter'|'pro'|'business', interval: 'monthly'|'annual' } */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    // Switching plans changes what the workspace pays: owner-only, like checkout.
    requirePermission(ctx, 'billing.manage');

    const body = await req.json();
    const tier = body.tier as PlanTier;
    const interval = body.interval as BillingInterval;

    if (!PLAN_TIERS.includes(tier)) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
    }
    if (!['monthly', 'annual'].includes(interval)) {
      return NextResponse.json({ error: 'Invalid interval' }, { status: 400 });
    }

    // Direct plan switches update an EXISTING Stripe subscription in place.
    // Free tier, lapsed subs, and manual comps (placeholder customer ids)
    // have nothing to update — the client falls back to checkout.
    const sub = await getSubscriptionForWorkspace(ctx.workspaceId);
    if (
      !sub ||
      !['active', 'trialing'].includes(sub.status) ||
      !hasStripeCustomer(sub) ||
      !sub.stripeSubscriptionId?.startsWith('sub_')
    ) {
      return NextResponse.json({ error: 'NO_BILLING_ACCOUNT' }, { status: 404 });
    }

    if (sub.tier === tier && sub.interval === interval) {
      return NextResponse.json({ error: 'ALREADY_ON_PLAN' }, { status: 400 });
    }

    // Add-ons the target tier can't carry must be removed first (the Add-ons
    // card handles that) — silently dropping paid items is not an option.
    const blocked = blockedAddons(sub, tier);
    if (blocked.length > 0) {
      return NextResponse.json(
        { error: 'ADDONS_NOT_AVAILABLE_ON_TIER', addons: blocked },
        { status: 409 },
      );
    }

    // Downgrades only: block when current usage wouldn't fit the target
    // limits, listing only the exceeded dimensions so the client can say
    // exactly what to reduce.
    if ((TIER_RANK[tier] ?? 0) < (TIER_RANK[sub.tier] ?? 0)) {
      const limits = targetLimits(tier, sub);
      const usage = await countUsage(ctx.uid, ctx.workspaceId);
      const details: Partial<Record<UsageDimension, { current: number; allowed: number }>> = {};
      for (const dim of ['brands', 'teamMembers', 'workspaces'] as UsageDimension[]) {
        if (limits[dim] !== -1 && usage[dim] > limits[dim]) {
          details[dim] = { current: usage[dim], allowed: limits[dim] };
        }
      }
      if (Object.keys(details).length > 0) {
        return NextResponse.json(
          { error: 'PLAN_DOWNGRADE_BLOCKED', details },
          { status: 409 },
        );
      }
    }

    const stripe = getStripe();

    // Same verification as checkout: an archived STRIPE_PRICE_* value would
    // otherwise fail the subscription update with "The price specified is
    // inactive" and leave the customer on their old plan with no explanation.
    const resolved = await resolvePlanPrice(stripe, tier, interval);
    if (!resolved.ok) {
      console.error('[stripe/change-plan] no usable price', { tier, interval, reason: resolved.reason });
      return NextResponse.json(
        { error: resolved.reason === 'NOT_CONFIGURED' ? 'Price not configured' : 'Price unavailable' },
        { status: 500 },
      );
    }
    if (resolved.substituted) {
      console.error('[stripe/change-plan] STRIPE_PRICE config is stale', {
        tier,
        interval,
        using: resolved.priceId,
        hint: 'update STRIPE_PRICE_* in apphosting.yaml to the active price id',
      });
    }
    const priceId = resolved.priceId;

    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    // The base plan item is the one whose price maps to a tier; add-on items
    // (extra brands/seats) map via addonFromPriceId and must be left alone.
    const baseItem = stripeSub.items.data.find(
      (item) => item.price?.id && tierFromPriceId(item.price.id),
    );
    if (!baseItem) {
      return NextResponse.json({ error: 'Base plan item not found' }, { status: 500 });
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: baseItem.id, price: priceId }],
      // Upgrades charge the difference now; downgrades credit unused time —
      // both land on the next invoice. Interval switches go through the same
      // call. A pending cancellation is cleared: picking a plan is a clear
      // signal the customer intends to stay.
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
    });

    // The customer.subscription.updated webhook is the source of truth; this
    // optimistic write just makes the settings UI reflect the change without
    // waiting on webhook delivery.
    await upsertSubscriptionForWorkspace(ctx.workspaceId, {
      tier,
      interval,
      stripePriceId: priceId,
      cancelAtPeriodEnd: false,
    });

    return NextResponse.json({ ok: true, tier, interval });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHENTICATED') {
      return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (err instanceof Error && (err.message === 'FORBIDDEN' || err.message === 'FORBIDDEN_WORKSPACE')) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[stripe/change-plan]', err);
    return NextResponse.json({ error: 'Plan change failed' }, { status: 500 });
  }
}
