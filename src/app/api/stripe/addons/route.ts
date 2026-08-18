import { NextResponse } from 'next/server';
import { getStripe, addonPriceId } from '@/lib/stripe/server';
import {
  getSubscriptionForWorkspace,
  isActiveSubscription,
  upsertSubscriptionForWorkspace,
} from '@/lib/stripe/subscription';
import { ADDONS, type AddonKey, type PlanTier } from '@/lib/stripe/plans';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';

export const runtime = 'nodejs';

/** GET /api/stripe/addons — current add-on quantities + what this plan may buy */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'billing.manage');

    const sub = await getSubscriptionForWorkspace(ctx.workspaceId);
    const tier = (isActiveSubscription(sub) ? sub.tier : null) as PlanTier | null;

    return NextResponse.json({
      addons: (Object.keys(ADDONS) as AddonKey[]).map((key) => ({
        key,
        name: ADDONS[key].name,
        price: ADDONS[key].price,
        quantity: key === 'brand' ? sub?.addonBrands ?? 0 : sub?.addonSeats ?? 0,
        available: Boolean(
          tier &&
          ADDONS[key].availableOn.includes(tier) &&
          sub?.interval &&
          addonPriceId(key, sub.interval),
        ),
      })),
    });
  } catch (err) {
    return addonError(err);
  }
}

/** POST /api/stripe/addons { addon: 'brand'|'seat', quantity: number } */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    // Add-ons change what the workspace pays: owner-only, like checkout.
    requirePermission(ctx, 'billing.manage');

    const body = await req.json();
    const addon = body.addon as AddonKey;
    const quantity = Number(body.quantity);

    if (!ADDONS[addon]) {
      return NextResponse.json({ error: 'Invalid addon' }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100) {
      return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 });
    }

    const sub = await getSubscriptionForWorkspace(ctx.workspaceId);
    if (!isActiveSubscription(sub) || !sub.stripeSubscriptionId) {
      return NextResponse.json({ error: 'SUBSCRIPTION_REQUIRED' }, { status: 402 });
    }
    const tier = sub.tier as PlanTier;
    if (!ADDONS[addon].availableOn.includes(tier)) {
      return NextResponse.json(
        { error: 'ADDON_NOT_AVAILABLE_ON_PLAN', tier },
        { status: 400 },
      );
    }

    const priceId = addonPriceId(addon, sub.interval);
    if (!priceId) {
      return NextResponse.json({ error: 'Addon price not configured' }, { status: 500 });
    }

    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const existingItem = stripeSub.items.data.find((item) => item.price?.id === priceId);

    if (existingItem && quantity === 0) {
      await stripe.subscriptionItems.del(existingItem.id, {
        proration_behavior: 'create_prorations',
      });
    } else if (existingItem) {
      await stripe.subscriptionItems.update(existingItem.id, {
        quantity,
        proration_behavior: 'create_prorations',
      });
    } else if (quantity > 0) {
      await stripe.subscriptionItems.create({
        subscription: sub.stripeSubscriptionId,
        price: priceId,
        quantity,
        proration_behavior: 'create_prorations',
      });
    }

    // The customer.subscription.updated webhook is the source of truth; this
    // optimistic write just makes the settings UI reflect the change without
    // waiting on webhook delivery.
    await upsertSubscriptionForWorkspace(ctx.workspaceId, {
      [addon === 'brand' ? 'addonBrands' : 'addonSeats']: quantity,
    });

    return NextResponse.json({ ok: true, addon, quantity });
  } catch (err) {
    return addonError(err);
  }
}

function addonError(err: unknown) {
  if (err instanceof Error && err.message === 'UNAUTHENTICATED') {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if (err instanceof Error && (err.message === 'FORBIDDEN' || err.message === 'FORBIDDEN_WORKSPACE')) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error('[stripe/addons]', err);
  return NextResponse.json({ error: 'Addon update failed' }, { status: 500 });
}
