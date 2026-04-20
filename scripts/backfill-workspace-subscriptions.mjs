/**
 * Backfill `subscriptions/{workspaceId}` from legacy `subscriptions/{uid}` docs.
 *
 * Before workspace-scoped billing, Stripe customers and subscriptions were
 * keyed by the Firebase uid of the purchasing user. After the migration,
 * subscriptions belong to the workspace (so an owner leaving doesn't take
 * the plan with them, and seat-less "flat rate per workspace" billing
 * actually maps to the correct entity).
 *
 * This script:
 *   1. Walks every doc in `subscriptions/` that does NOT yet have a
 *      `workspaceId` field.
 *   2. Resolves the workspace the uid owns (or the first personal workspace
 *      they belong to) via the `workspaces/*\/members` collection.
 *   3. Writes the subscription payload into `subscriptions/{workspaceId}`
 *      with `workspaceId` set, preserving the original `subscriptions/{uid}`
 *      doc as a read-only fallback until the next deploy.
 *   4. Updates the Stripe Customer metadata to include `workspaceId` and
 *      the Subscription metadata on the active subscription so new webhook
 *      events route to the workspace doc directly.
 *
 * It is idempotent and safe to run against production:
 *   - Already-migrated docs (workspaceId present) are skipped.
 *   - Stripe metadata writes are no-ops when the value already matches.
 *   - Pass --dry-run to print the plan without writing anything.
 *
 * Usage:
 *
 *   # Local: reads GOOGLE_APPLICATION_CREDENTIALS + STRIPE_SECRET_KEY from env
 *   node scripts/backfill-workspace-subscriptions.mjs --dry-run
 *   node scripts/backfill-workspace-subscriptions.mjs
 *
 *   # Skip Stripe metadata sync (Firestore only)
 *   node scripts/backfill-workspace-subscriptions.mjs --skip-stripe
 */

import admin from 'firebase-admin';
import Stripe from 'stripe';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_STRIPE = process.argv.includes('--skip-stripe');
const VERBOSE = process.argv.includes('--verbose');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey && !SKIP_STRIPE ? new Stripe(stripeKey) : null;

async function findWorkspaceForUid(uid) {
  // Prefer a workspace where this uid is owner — that's where their plan
  // should live. Fall back to any membership if no owner record exists
  // (shouldn't happen post-migration but we want to be tolerant).
  const ownerSnap = await db
    .collectionGroup('members')
    .where('uid', '==', uid)
    .where('role', '==', 'owner')
    .limit(1)
    .get();

  if (!ownerSnap.empty) {
    const parts = ownerSnap.docs[0].ref.path.split('/');
    return parts[1];
  }

  const anySnap = await db
    .collectionGroup('members')
    .where('uid', '==', uid)
    .limit(1)
    .get();

  if (!anySnap.empty) {
    const parts = anySnap.docs[0].ref.path.split('/');
    return parts[1];
  }

  return null;
}

async function syncStripeMetadata(sub, workspaceId) {
  if (!stripe) return;
  try {
    if (sub.stripeCustomerId) {
      const customer = await stripe.customers.retrieve(sub.stripeCustomerId);
      if (!customer.deleted && customer.metadata?.workspaceId !== workspaceId) {
        await stripe.customers.update(sub.stripeCustomerId, {
          metadata: { ...(customer.metadata || {}), workspaceId },
        });
      }
    }
    if (sub.stripeSubscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      if (subscription.metadata?.workspaceId !== workspaceId) {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          metadata: { ...(subscription.metadata || {}), workspaceId },
        });
      }
    }
  } catch (err) {
    console.warn(`  ! Stripe metadata sync failed for ${sub.stripeSubscriptionId}:`, err.message);
  }
}

async function run() {
  console.log(`Backfill workspace subscriptions${DRY_RUN ? ' (dry run)' : ''}`);

  const snap = await db.collection('subscriptions').get();
  let migrated = 0;
  let skipped = 0;
  let unresolved = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const docId = doc.id;

    if (data.workspaceId) {
      if (VERBOSE) console.log(`  - ${docId}: already migrated → ${data.workspaceId}`);
      skipped += 1;
      continue;
    }

    // Legacy uid-keyed document. Find the owning workspace.
    const uid = docId;
    const workspaceId = await findWorkspaceForUid(uid);
    if (!workspaceId) {
      console.warn(`  ! ${docId}: no workspace membership found, skipping`);
      unresolved += 1;
      continue;
    }

    const targetRef = db.collection('subscriptions').doc(workspaceId);
    const targetSnap = await targetRef.get();

    if (targetSnap.exists && targetSnap.data()?.stripeSubscriptionId) {
      // Workspace already has a subscription — do not clobber it. Operator
      // should reconcile manually if this happens.
      console.warn(
        `  ! ${docId}: workspace ${workspaceId} already has a subscription, skipping (reconcile manually)`,
      );
      skipped += 1;
      continue;
    }

    console.log(`  + ${docId} → ${workspaceId} (${data.status} / ${data.tier})`);

    if (!DRY_RUN) {
      await targetRef.set(
        {
          ...data,
          workspaceId,
          migratedFromUid: uid,
          migratedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      await syncStripeMetadata(data, workspaceId);
    }

    migrated += 1;
  }

  console.log('');
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Unresolved: ${unresolved}`);
  if (DRY_RUN) console.log('(dry run — no writes performed)');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
