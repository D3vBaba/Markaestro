import { NextResponse } from 'next/server';
import { requireContext } from '@/lib/server-auth';
import {
  getEffectiveSubscription,
  getSubscriptionForWorkspace,
  resolveStatus,
} from '@/lib/stripe/subscription';
import { hasStripeCustomer } from '@/lib/stripe/server';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const [sub, workspaceSub] = await Promise.all([
      getEffectiveSubscription(ctx.uid, ctx.workspaceId),
      getSubscriptionForWorkspace(ctx.workspaceId),
    ]);
    const status = resolveStatus(sub);

    // The billing portal manages the WORKSPACE's Stripe customer. Manual
    // grants and comps carry placeholder customer ids, so the portal (and
    // any "manage billing" UI) only works when a real `cus_` id exists.
    return NextResponse.json({
      ...status,
      billable: hasStripeCustomer(workspaceSub),
    });
  } catch (err) {
    console.error('[stripe/status]', err);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
