import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProbeResult = { ok: boolean; latencyMs?: number; error?: string };

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function timed(fn: () => Promise<unknown>): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await withTimeout(fn(), 2500);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get('deep') === '1';

  // Shallow probe: just confirm the process is alive. Cloud Run's
  // startup/liveness checks call this on every deploy; we cannot fail it
  // because a downstream outage must not break our own deploys.
  if (!deep) {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptimeSeconds: process.uptime(),
    });
  }

  // Deep probe: exercise every hard dependency. Use `/api/health?deep=1`
  // from the uptime monitor so we page on real outages, not cold starts.
  const checks: Record<string, ProbeResult> = {
    firestore: await timed(async () => {
      await adminDb.collection('_healthCheck').doc('ping').get();
    }),
    secretManager: await timed(async () => {
      // Presence of expected env vars is enough — absence means
      // Secret Manager failed to resolve during boot.
      const required = ['STRIPE_SECRET_KEY', 'OPENAI_API_KEY'];
      const missing = required.filter((k) => !process.env[k]);
      if (missing.length) throw new Error(`missing secrets: ${missing.join(', ')}`);
    }),
    stripe: await timed(async () => {
      // Import lazily to avoid a cold-start cost when stripe is unneeded.
      const { getStripe } = await import('@/lib/stripe/server');
      await getStripe().products.list({ limit: 1 });
    }),
  };

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptimeSeconds: process.uptime(),
      checks,
    },
    { status: ok ? 200 : 503 },
  );
}
