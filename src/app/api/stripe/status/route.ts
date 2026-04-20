import { NextResponse } from 'next/server';
import { requireContext } from '@/lib/server-auth';
import { getEffectiveSubscription, resolveStatus } from '@/lib/stripe/subscription';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const sub = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    const status = resolveStatus(sub);

    return NextResponse.json(status);
  } catch (err) {
    console.error('[stripe/status]', err);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
