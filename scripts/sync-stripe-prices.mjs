/**
 * Sync Markaestro Stripe products + prices to match src/lib/stripe/plans.ts.
 *
 * Stripe prices are immutable — you can't change `unit_amount` on an existing
 * price. The correct update flow is:
 *   1. Find product by metadata.app=markaestro + metadata.tier=<tier>
 *      (create if missing).
 *   2. For each tier × interval, check if there's an ACTIVE price with the
 *      desired amount already. If so, no-op.
 *   3. Otherwise, create a new price with the new amount and archive any
 *      other active prices of that tier × interval so the old ones stop
 *      being offered to new subscribers.
 *
 * Existing subscribers keep their grandfathered price — Stripe only moves
 * them if you explicitly migrate them. This script is safe to run repeatedly.
 *
 * Usage:
 *
 *   # Local (reads STRIPE_SECRET_KEY from env or .env.local)
 *   node scripts/sync-stripe-prices.mjs
 *
 *   # Preview without writing anything
 *   node scripts/sync-stripe-prices.mjs --dry-run
 *
 *   # Pull STRIPE_SECRET_KEY from Google Secret Manager
 *   GOOGLE_CLOUD_PROJECT=my-project \
 *     node scripts/sync-stripe-prices.mjs --from-secret-manager
 *
 *   # Also migrate existing subscribers onto the new prices (DANGEROUS).
 *   # Without this flag, only new checkouts see the new prices; existing
 *   # customers stay on their current price until the next renewal.
 *   node scripts/sync-stripe-prices.mjs --migrate-subscriptions
 *
 * Output: an env-var block mapping tier × interval → price ID. Update your
 * STRIPE_PRICE_* secrets (in Secret Manager or .env.local) with these values
 * so the app hands customers the new prices at checkout.
 */

import Stripe from 'stripe';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── Config ─────────────────────────────────────────────────────────
//
// MIRROR OF src/lib/stripe/plans.ts — keep these in sync whenever you
// change the pricing in plans.ts. Amounts are in dollars; Stripe needs
// them in cents, which we convert below.

/** @type {Array<{ tier: 'starter' | 'pro' | 'business'; name: string; description: string; monthly: number; annual: number }>} */
const TIERS = [
  {
    tier: 'starter',
    name: 'Markaestro Starter',
    description: 'For solo marketers publishing across Meta and TikTok.',
    monthly: 29,
    annual: 24, // per-month equivalent — billed 24*12 = 288 / year
  },
  {
    tier: 'pro',
    name: 'Markaestro Pro',
    description: 'For growing teams that need ad management, AI, and collaboration.',
    monthly: 69,
    annual: 57, // billed 57*12 = 684 / year
  },
  {
    tier: 'business',
    name: 'Markaestro Business',
    description: 'For agencies managing multiple brands at scale.',
    monthly: 199,
    annual: 165, // billed 165*12 = 1,980 / year
  },
];

const APP_TAG = 'markaestro';

// ── CLI args ───────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FROM_SECRET_MANAGER = args.has('--from-secret-manager');
const MIGRATE_SUBS = args.has('--migrate-subscriptions');

// ── Cross-check with plans.ts ──────────────────────────────────────
//
// The TIERS above are mirrored from src/lib/stripe/plans.ts. To catch
// accidental drift, we parse plans.ts and compare the price numbers.
// If they disagree, refuse to run — you either need to update TIERS
// here or update plans.ts, not both in different directions.

async function verifyAgainstPlansFile() {
  const here = dirname(fileURLToPath(import.meta.url));
  const plansPath = resolve(here, '..', 'src', 'lib', 'stripe', 'plans.ts');
  const source = await readFile(plansPath, 'utf8');

  const mismatches = [];
  for (const t of TIERS) {
    // Each tier appears as: <tier>: { ... price: { monthly: N, annual: N }, ... }
    const blockRe = new RegExp(
      `${t.tier}:\\s*\\{[\\s\\S]*?price:\\s*\\{\\s*monthly:\\s*(\\d+)\\s*,\\s*annual:\\s*(\\d+)\\s*\\}`,
      'm',
    );
    const m = source.match(blockRe);
    if (!m) {
      mismatches.push(`${t.tier}: could not locate price block in plans.ts`);
      continue;
    }
    const [, monthly, annual] = m;
    if (Number(monthly) !== t.monthly || Number(annual) !== t.annual) {
      mismatches.push(
        `${t.tier}: plans.ts says $${monthly}/$${annual}, script says $${t.monthly}/$${t.annual}`,
      );
    }
  }

  if (mismatches.length) {
    console.error('\n✗ Drift detected between this script and src/lib/stripe/plans.ts:\n');
    for (const m of mismatches) console.error(`  - ${m}`);
    console.error('\nUpdate both files to match, then re-run.\n');
    process.exit(1);
  }
}

// ── Secret loading ─────────────────────────────────────────────────

async function loadStripeKey() {
  if (!FROM_SECRET_MANAGER) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      console.error('Set STRIPE_SECRET_KEY (or pass --from-secret-manager).');
      process.exit(1);
    }
    return key;
  }

  const project =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project) {
    console.error('Set GOOGLE_CLOUD_PROJECT when using --from-secret-manager.');
    process.exit(1);
  }

  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  const client = new SecretManagerServiceClient();
  const [res] = await client.accessSecretVersion({
    name: `projects/${project}/secrets/STRIPE_SECRET_KEY/versions/latest`,
  });
  const key = res.payload?.data?.toString() ?? '';
  if (!key) {
    console.error('STRIPE_SECRET_KEY not found in Secret Manager.');
    process.exit(1);
  }
  return key;
}

// ── Main sync logic ────────────────────────────────────────────────

/**
 * Find (by metadata) or create the Stripe product for a given tier.
 * Also keeps `name` + `description` in sync with the config.
 */
async function upsertProduct(stripe, tier) {
  // Stripe's product search API supports metadata lookups.
  const query = `metadata["app"]:"${APP_TAG}" AND metadata["tier"]:"${tier.tier}"`;
  const existing = await stripe.products.search({ query, limit: 2 });

  if (existing.data.length > 1) {
    throw new Error(
      `Found ${existing.data.length} products tagged tier=${tier.tier}. ` +
        `Resolve this manually — archive the duplicates before re-running.`,
    );
  }

  if (existing.data.length === 1) {
    const product = existing.data[0];
    // Keep name/description in sync — these are mutable on Stripe.
    const drift =
      product.name !== tier.name || product.description !== tier.description;
    if (drift && !DRY_RUN) {
      await stripe.products.update(product.id, {
        name: tier.name,
        description: tier.description,
      });
    }
    return { product, created: false, updated: drift };
  }

  if (DRY_RUN) {
    return { product: { id: `(would-create-${tier.tier})` }, created: true, updated: false };
  }

  const product = await stripe.products.create({
    name: tier.name,
    description: tier.description,
    metadata: { app: APP_TAG, tier: tier.tier },
  });
  return { product, created: true, updated: false };
}

/**
 * Ensure a single active price exists for the given tier × interval at the
 * desired amount. Returns the price that should be wired into env vars.
 *
 * If an active price at the correct amount already exists, returns it.
 * Otherwise creates a new one and archives any other active prices for
 * that tier × interval (so only one active price is ever offered).
 */
async function upsertPrice(stripe, product, tier, interval) {
  const isAnnual = interval === 'annual';
  const unitAmountCents = isAnnual
    ? Math.round(tier.annual * 100 * 12) // charge the full year up front
    : Math.round(tier.monthly * 100);
  const recurring = isAnnual ? { interval: 'year' } : { interval: 'month' };

  // List all active prices attached to this product, filter to this tier × interval.
  // We use metadata-based filtering because we tag each price at create time.
  const all = [];
   
  for await (const p of stripe.prices.list({
    product: product.id,
    active: true,
    limit: 100,
  })) {
    if (p.metadata?.tier === tier.tier && p.metadata?.interval === interval) {
      all.push(p);
    }
  }

  const match = all.find((p) => p.unit_amount === unitAmountCents);
  const toArchive = all.filter((p) => p.id !== match?.id);

  if (match && toArchive.length === 0) {
    return { price: match, action: 'kept' };
  }

  if (DRY_RUN) {
    return {
      price: match ?? { id: `(would-create-${tier.tier}-${interval})`, unit_amount: unitAmountCents },
      action: match ? 'kept-archive-dupes' : 'would-create',
      archivedCount: toArchive.length,
    };
  }

  const price =
    match ??
    (await stripe.prices.create({
      product: product.id,
      unit_amount: unitAmountCents,
      currency: 'usd',
      recurring,
      metadata: { tier: tier.tier, interval },
    }));

  // Archive stale prices after creating the replacement, so there's no
  // window where new checkouts have no price to pick.
  for (const old of toArchive) {
     
    await stripe.prices.update(old.id, { active: false });
  }

  return {
    price,
    action: match ? 'archived-dupes' : 'created',
    archivedCount: toArchive.length,
  };
}

/**
 * Walk every active subscription on every synced product and, for any sub
 * still on an archived/old price, move it to the new one at the next
 * renewal (proration_behavior=none). Only runs when --migrate-subscriptions
 * is passed.
 */
async function migrateSubscriptions(stripe, priceMap) {
  // priceMap: { [tier]: { monthly: {id, unit_amount}, annual: {id, unit_amount} } }
  let scanned = 0;
  let migrated = 0;
  const moves = [];

  for (const tier of TIERS) {
    for (const interval of ['monthly', 'annual']) {
      const targetPrice = priceMap[tier.tier][interval];
      if (!targetPrice?.id) continue;

       
      for await (const sub of stripe.subscriptions.list({
        status: 'all',
        limit: 100,
        expand: ['data.items.data.price'],
      })) {
        scanned++;

        // Only touch live subs
        if (!['active', 'trialing', 'past_due'].includes(sub.status)) continue;

        // Find items whose price belongs to this product × interval and has
        // a different id from the target.
        const staleItems = sub.items.data.filter((item) => {
          const p = item.price;
          return (
            p.product === targetPrice.product &&
            p.metadata?.interval === interval &&
            p.id !== targetPrice.id
          );
        });
        if (staleItems.length === 0) continue;

        if (DRY_RUN) {
          moves.push({ sub: sub.id, from: staleItems.map((i) => i.price.id), to: targetPrice.id });
          continue;
        }

         
        await stripe.subscriptions.update(sub.id, {
          items: staleItems.map((item) => ({
            id: item.id,
            price: targetPrice.id,
          })),
          proration_behavior: 'none', // honor at next renewal, no surprise charges
          metadata: {
            ...sub.metadata,
            migrated_at: new Date().toISOString(),
            migrated_by: 'sync-stripe-prices.mjs',
          },
        });
        migrated++;
        moves.push({ sub: sub.id, from: staleItems.map((i) => i.price.id), to: targetPrice.id });
      }
    }
  }

  return { scanned, migrated, moves };
}

// ── Entry point ────────────────────────────────────────────────────

async function main() {
  await verifyAgainstPlansFile();

  const key = await loadStripeKey();
  const mode = key.startsWith('sk_live_') ? 'LIVE' : key.startsWith('sk_test_') ? 'TEST' : 'UNKNOWN';
  const stripe = new Stripe(key);

  console.log(`\nMarkaestro Stripe price sync — mode: ${mode}${DRY_RUN ? ' (dry run)' : ''}\n`);

  // priceMap: { [tier]: { monthly: Price, annual: Price } }
  const priceMap = {};
  const envLines = [];

  for (const tier of TIERS) {
    const { product, created, updated } = await upsertProduct(stripe, tier);
    const productLabel = created ? 'created' : updated ? 'updated' : 'found';
    console.log(`• ${tier.name} (${tier.tier}) — product ${productLabel} [${product.id}]`);

    priceMap[tier.tier] = {};
    for (const interval of ['monthly', 'annual']) {
      const result = await upsertPrice(stripe, product, tier, interval);
      priceMap[tier.tier][interval] = result.price;

      const amountDisplay = result.price.unit_amount
        ? `$${(result.price.unit_amount / 100).toFixed(2)}`
        : '?';
      const intervalLabel = interval === 'annual' ? 'annual (charged yearly)' : 'monthly';
      const extra =
        result.archivedCount > 0 ? ` (archived ${result.archivedCount} old)` : '';
      console.log(
        `  ${interval.padEnd(7)} ${amountDisplay.padEnd(9)} ${intervalLabel.padEnd(25)} ${result.action}${extra} [${result.price.id}]`,
      );

      envLines.push(
        `STRIPE_PRICE_${tier.tier.toUpperCase()}_${interval.toUpperCase()}=${result.price.id}`,
      );
    }
  }

  if (MIGRATE_SUBS) {
    console.log('\nMigrating existing subscriptions to new prices...\n');
    const { scanned, migrated, moves } = await migrateSubscriptions(stripe, priceMap);
    console.log(`  Scanned ${scanned} subs, migrated ${migrated}.`);
    if (moves.length && moves.length <= 20) {
      for (const m of moves) console.log(`    ${m.sub}: ${m.from.join(',')} → ${m.to}`);
    }
  } else {
    console.log(
      '\nSkipping subscription migration (pass --migrate-subscriptions to move existing customers).',
    );
  }

  console.log('\n── Env vars to update (Secret Manager + .env.local) ─────────────\n');
  console.log(envLines.join('\n'));
  console.log('\n' + (DRY_RUN ? '(dry run — no changes written)' : 'Done.'));
}

main().catch((err) => {
  console.error('\n✗ sync-stripe-prices failed:', err.message || err);
  if (err.raw) console.error(err.raw);
  process.exit(1);
});
