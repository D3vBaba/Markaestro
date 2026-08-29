#!/usr/bin/env node
/**
 * Recount each media asset's post references from the posts that actually
 * exist.
 *
 * The 1.3 backfill deliberately wrote `refCount: 0` with `orphanedAt: null`
 * ("counts are unknown for history, and the sweep must not delete a
 * customer's media on the strength of a count this script invented"). That
 * kept the sweep away from historical media, but it also makes the media
 * library label in-use assets "not used in any posts", and an "unused"
 * filter built on the field would lie for every backfilled record.
 *
 * This script computes the truth once: for every asset, count the posts
 * whose `mediaUrls` contains its URL, and store that count. Assets that turn
 * out to be genuinely unreferenced KEEP `orphanedAt: null` — becoming
 * sweepable still requires a real release event (post delete/edit), so
 * nothing here schedules a deletion.
 *
 * Idempotent; safe to re-run. Usage:
 *   node --env-file=.env.local scripts/reconcile-media-refcounts.mjs --dry-run
 *   node --env-file=.env.local scripts/reconcile-media-refcounts.mjs
 */

import admin from 'firebase-admin';

const DRY_RUN = process.argv.includes('--dry-run');
const WORKSPACE_ARG = process.argv.find((arg) => arg.startsWith('--workspace='));
const ONLY_WORKSPACE = WORKSPACE_ARG ? WORKSPACE_ARG.split('=')[1] : null;

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

async function reconcileWorkspace(workspaceId) {
  const assetsSnap = await db.collection(`workspaces/${workspaceId}/media_assets`).get();
  let checked = 0;
  let corrected = 0;
  const updates = [];

  for (const doc of assetsSnap.docs) {
    const asset = doc.data();
    const url = asset.downloadUrl;
    if (typeof url !== 'string' || !url) continue;
    checked += 1;

    const referencing = await db
      .collection(`workspaces/${workspaceId}/posts`)
      .where('mediaUrls', 'array-contains', url)
      .count()
      .get();
    const actual = referencing.data().count;
    const stored = Number(asset.refCount) || 0;
    if (actual === stored) continue;

    corrected += 1;
    updates.push({ ref: doc.ref, id: doc.id, stored, actual });
  }

  if (!DRY_RUN) {
    for (let index = 0; index < updates.length; index += 450) {
      const batch = db.batch();
      for (const update of updates.slice(index, index + 450)) {
        batch.set(update.ref, {
          refCount: update.actual,
          // A recount proving the asset is referenced clears any stale
          // orphan mark; a zero count deliberately does NOT set one.
          ...(update.actual > 0 ? { orphanedAt: null } : {}),
          refCountReconciledAt: new Date().toISOString(),
        }, { merge: true });
      }
      await batch.commit();
    }
  }

  return { workspaceId, checked, corrected, updates };
}

const workspaces = ONLY_WORKSPACE
  ? [ONLY_WORKSPACE]
  : (await db.collection('workspaces').get()).docs.map((doc) => doc.id);

console.log(DRY_RUN ? 'DRY RUN. Nothing will be written.\n' : '');
let totalCorrected = 0;
for (const workspaceId of workspaces) {
  const result = await reconcileWorkspace(workspaceId);
  totalCorrected += result.corrected;
  if (result.corrected > 0) {
    console.log(`  ${workspaceId}: ${result.checked} asset(s), ${result.corrected} count(s) corrected`);
    for (const update of result.updates.slice(0, 8)) {
      console.log(`    ${update.id}: ${update.stored} -> ${update.actual}`);
    }
    if (result.updates.length > 8) console.log(`    … and ${result.updates.length - 8} more`);
  }
}
console.log(`\nTotal corrections: ${totalCorrected}${DRY_RUN ? ' (dry run)' : ''}`);
process.exit(0);
