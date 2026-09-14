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
  { tier: 'starter', name: 'Markaestro Starter', monthly: 1900, annual: 19200 },
  { tier: 'growth', name: 'Markaestro Growth', monthly: 2999, annual: 29988 },
  { tier: 'pro', name: 'Markaestro Pro', monthly: 5900, annual: 58800 },
  { tier: 'business', name: 'Markaestro Business', monthly: 14900, annual: 148800 },
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
