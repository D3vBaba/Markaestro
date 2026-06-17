/**
 * Manually grant a comped plan to a user by email — at the ACCOUNT level.
 *
 * Entitlements written here live in `accountEntitlements/{uid}` and are keyed by
 * the Firebase uid, not a workspace. `getEffectiveSubscription`
 * (src/lib/stripe/subscription.ts) checks this first and an active entitlement
 * overrides the per-workspace subscription, so the user has the plan in EVERY
 * workspace they belong to or create.
 *
 * Access is "active" purely on the `status` field (`active` | `trialing`), so a
 * comp just writes `status: 'active'` + `tier: 'pro'`. `currentPeriodEnd` records
 * the intended expiry (one year out by default) — there is no automatic expiry
 * job, so revoke manually (or re-run with --revoke) when testing is done.
 *
 * Credentials: Application Default Credentials. Set the project explicitly
 * because the local gcloud default project may be something else.
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=markaestro-0226220726 \
 *     node scripts/grant-pro-access.mjs appstoretester25@gmail.com
 *
 *   # options
 *   --tier=pro|starter|business   (default: pro)
 *   --interval=annual|monthly     (default: annual)
 *   --months=12                   (default: 12)
 *   --dry-run                     (print plan, write nothing)
 *   --revoke                      (delete the account entitlement instead)
 */

import admin from 'firebase-admin';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const DRY_RUN = args.includes('--dry-run');
const REVOKE = args.includes('--revoke');
const TIER = flag('tier', 'pro');
const INTERVAL = flag('interval', 'annual');
const MONTHS = Number(flag('months', '12'));

if (!email) {
  console.error('Usage: node scripts/grant-pro-access.mjs <email> [--tier=pro] [--interval=annual] [--months=12] [--dry-run] [--revoke]');
  process.exit(1);
}

const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
}

const db = admin.firestore();
const auth = admin.auth();
const COLLECTION = 'accountEntitlements';

async function run() {
  console.log(`Project:  ${projectId || '(default)'}`);
  console.log(`Email:    ${email}`);

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.error(`\n✗ No Firebase Auth user exists for ${email}.`);
      console.error('  The tester must sign up / sign in to the app at least once first,');
      console.error('  then re-run this script.');
      process.exit(1);
    }
    throw err;
  }

  console.log(`UID:      ${user.uid}`);
  console.log(`Entitlement: ${COLLECTION}/${user.uid} (account-level — all workspaces)`);

  const ref = db.collection(COLLECTION).doc(user.uid);

  if (REVOKE) {
    console.log(`\nRevoking account entitlement for ${email}`);
    if (!DRY_RUN) await ref.delete();
    console.log(DRY_RUN ? '(dry run — nothing deleted)' : '✓ Revoked.');
    return;
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + MONTHS);

  const payload = {
    uid: user.uid,
    email,
    stripeCustomerId: `manual_grant_${user.uid}`,
    stripeSubscriptionId: `manual_grant_${user.uid}`,
    stripePriceId: '',
    tier: TIER,
    interval: INTERVAL,
    status: 'active',
    trialEnd: null,
    currentPeriodEnd: periodEnd.toISOString(),
    cancelAtPeriodEnd: false,
    compedBy: 'manual grant (Facebook app reviewers)',
    compedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  console.log('\nGrant payload:');
  console.log(JSON.stringify(payload, null, 2));

  if (DRY_RUN) {
    console.log('\n(dry run — nothing written)');
    return;
  }

  await ref.set(payload, { merge: true });
  console.log(`\n✓ Granted ${TIER} (${INTERVAL}) to ${email} until ${periodEnd.toISOString().slice(0, 10)} — across all workspaces.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
