/**
 * One-time: creates Markaestro products + recurring prices in Stripe.
 * Usage: STRIPE_SECRET_KEY=sk_... node scripts/setup-stripe-products.mjs
 */
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Set STRIPE_SECRET_KEY');
  process.exit(1);
}

const stripe = new Stripe(key);

const tiers = [
  { tier: 'starter', name: 'Markaestro Starter', monthly: 2900, annual: 28800 },
  { tier: 'pro', name: 'Markaestro Pro', monthly: 7900, annual: 79200 },
  { tier: 'business', name: 'Markaestro Business', monthly: 19900, annual: 199200 },
];

const lines = [];

for (const t of tiers) {
  const product = await stripe.products.create({
    name: t.name,
    description: 'Markaestro marketing automation subscription',
    metadata: { app: 'markaestro', tier: t.tier },
  });

  const monthly = await stripe.prices.create({
    product: product.id,
    unit_amount: t.monthly,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { tier: t.tier, interval: 'monthly' },
  });

  const annual = await stripe.prices.create({
    product: product.id,
    unit_amount: t.annual,
    currency: 'usd',
    recurring: { interval: 'year' },
    metadata: { tier: t.tier, interval: 'annual' },
  });

  lines.push(`STRIPE_PRICE_${t.tier.toUpperCase()}_MONTHLY=${monthly.id}`);
  lines.push(`STRIPE_PRICE_${t.tier.toUpperCase()}_ANNUAL=${annual.id}`);
}

console.log(lines.join('\n'));
