import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { safeCompare } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, applyRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProbeResult = { ok: boolean; latencyMs?: number; error?: string };
/** What the deep probe returns to the caller: never the raw dependency error. */
type PublicProbeResult = { ok: boolean; latencyMs?: number; code?: string };

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

/**
 * The deep probe's shared secret. `HEALTH_PROBE_SECRET` when set, otherwise
 * `WORKER_SECRET`, so an existing deployment keeps working without a new
 * secret and a monitor-only credential can be issued later.
 */
function deepProbeSecret(): string {
  return process.env.HEALTH_PROBE_SECRET || process.env.WORKER_SECRET || '';
}

/**
 * A failed dependency returns a code, not the upstream error text. The verbatim
 * message goes to the logs, where it is just as useful and not a free map of
 * the stack for anyone who can reach the URL.
 */
function toPublicResult(result: ProbeResult): PublicProbeResult {
  if (result.ok) return { ok: true, latencyMs: result.latencyMs };
  const timedOut = result.error?.includes('probe timed out');
  return { ok: false, latencyMs: result.latencyMs, code: timedOut ? 'PROBE_TIMEOUT' : 'PROBE_FAILED' };
}

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get('deep') === '1';

  // Shallow probe: just confirm the process is alive. Cloud Run's
  // startup/liveness checks call this on every deploy; we cannot fail it
  // because a downstream outage must not break our own deploys. It stays
  // open and unmetered for the same reason.
  if (!deep) {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptimeSeconds: process.uptime(),
    });
  }

  // Deep probe: exercise every hard dependency. Use `/api/health?deep=1`
  // with the shared secret from the uptime monitor so we page on real
  // outages, not cold starts. Unauthenticated callers get the shallow
  // answer's shape and none of the dependency detail, because each deep
  // request costs a Firestore read and a Stripe call.
  const secret = deepProbeSecret();
  const token = req.headers.get('x-health-probe-secret') || req.headers.get('x-worker-secret') || '';
  if (!secret || !safeCompare(token, secret)) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  try {
    await applyRateLimit(req, RATE_LIMITS.health);
  } catch (rateLimited) {
    if (rateLimited instanceof Response) return rateLimited;
    throw rateLimited;
  }

  const checks: Record<string, ProbeResult> = {
    firestore: await timed(async () => {
      await adminDb.collection('_healthCheck').doc('ping').get();
    }),
    secretManager: await timed(async () => {
      // Presence of expected env vars is enough — absence means
      // Secret Manager failed to resolve during boot.
      const required = ['STRIPE_SECRET_KEY'];
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
  if (!ok) {
    logger.error('Deep health probe reported a degraded dependency', {
      event: 'health.deep_probe_degraded',
      failures: Object.entries(checks)
        .filter(([, result]) => !result.ok)
        .map(([name, result]) => ({ dependency: name, error: result.error, latencyMs: result.latencyMs })),
    });
  }

  const publicChecks: Record<string, PublicProbeResult> = {};
  for (const [name, result] of Object.entries(checks)) publicChecks[name] = toPublicResult(result);

  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptimeSeconds: process.uptime(),
      checks: publicChecks,
    },
    { status: ok ? 200 : 503 },
  );
}
