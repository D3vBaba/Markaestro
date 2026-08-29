/**
 * Reconcile historical media: create `media_assets` records for orphaned
 * storage objects, and recompute each workspace's storage counter from the
 * bytes actually stored.
 *
 * Why this exists. The in-app upload paths reserved storage bytes, wrote the
 * object, and never created a `media_assets` document. Only the public and
 * connect API upload paths did. So for every in-app upload ever made there is
 * an object in Cloud Storage that nothing can list and nothing can delete,
 * and a workspace counter that went up and could never come back down. A Pro
 * customer who filled 10 GB got `QUOTA_EXCEEDED_STORAGE` on every upload with
 * no self-service way to free a single byte.
 *
 * The code fix (writing the record on upload) only helps new uploads. This
 * script is what makes existing customers whole.
 *
 * What it does, per workspace:
 *   1. Lists every object under `workspaces/{id}/uploads/`, `/public-media/`,
 *      and `/videos/`.
 *   2. Creates a `media_assets` doc for any object with no matching record,
 *      using the metadata `uploadToStorage` already writes (`workspaceId`,
 *      `uploadedBy`, `uploadedAt`, `originalFileName`).
 *   3. Recomputes `usage/workspace:{id}.storageBytes` as the sum of actual
 *      object sizes, and reports the difference against the stored value.
 *
 * That difference is the honest measure of how much the bug has cost people.
 * Run in dry-run first and read it before writing anything.
 *
 * It is idempotent and safe to re-run:
 *   - Objects that already have a record are skipped.
 *   - Recomputation is derived from storage, not from the previous counter.
 *
 * Usage:
 *
 *   # Report only. Writes nothing. Start here.
 *   node scripts/backfill-media-assets.mjs --dry-run
 *
 *   # Apply, all workspaces
 *   node scripts/backfill-media-assets.mjs
 *
 *   # Apply to one workspace
 *   node scripts/backfill-media-assets.mjs --workspace=ws_abc123
 *
 *   # Create the missing records but leave the usage counters alone
 *   node scripts/backfill-media-assets.mjs --skip-usage
 */

import admin from 'firebase-admin';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_USAGE = process.argv.includes('--skip-usage');
const VERBOSE = process.argv.includes('--verbose');
const WORKSPACE_ARG = process.argv.find((arg) => arg.startsWith('--workspace='));
const ONLY_WORKSPACE = WORKSPACE_ARG ? WORKSPACE_ARG.split('=')[1] : null;

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

/** Storage prefixes that hold user media, and the asset type each implies. */
const MEDIA_PREFIXES = [
  { prefix: 'uploads', type: null },        // mixed; inferred from content type
  { prefix: 'public-media', type: 'image' },
  { prefix: 'videos', type: 'video' },
];

function assetTypeFor(contentType, fallback) {
  if (fallback) return fallback;
  return String(contentType || '').startsWith('video/') ? 'video' : 'image';
}

/**
 * Asset id for a storage object.
 *
 * In-app uploads are named `{uuid}.{ext}` and the new code records them as
 * `ast_{uuid}`, so deriving the id the same way here means a re-run after the
 * code fix ships will not duplicate anything. API uploads are already named
 * `ast_{uuid}.{ext}`.
 */
function assetIdForObject(name) {
  const base = name.split('/').pop().replace(/\.[^.]+$/, '');
  return base.startsWith('ast_') ? base : `ast_${base}`;
}

function buildDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function listWorkspaceIds() {
  if (ONLY_WORKSPACE) return [ONLY_WORKSPACE];
  const snap = await db.collection('workspaces').select().get();
  return snap.docs.map((doc) => doc.id);
}

async function reconcileWorkspace(workspaceId) {
  const existingSnap = await db.collection(`workspaces/${workspaceId}/media_assets`).select('storagePath').get();
  const knownPaths = new Set(
    existingSnap.docs.map((doc) => doc.data().storagePath).filter(Boolean),
  );

  let objectCount = 0;
  let totalBytes = 0;
  let created = 0;
  let skippedNoToken = 0;
  const toCreate = [];

  for (const { prefix, type } of MEDIA_PREFIXES) {
    const [files] = await bucket.getFiles({ prefix: `workspaces/${workspaceId}/${prefix}/` });
    for (const file of files) {
      // Directory placeholder objects have no real content.
      if (file.name.endsWith('/')) continue;
      objectCount++;
      const size = Number(file.metadata.size) || 0;
      totalBytes += size;

      if (knownPaths.has(file.name)) continue;

      const custom = file.metadata.metadata || {};
      const token = custom.firebaseStorageDownloadTokens
        ? String(custom.firebaseStorageDownloadTokens).split(',')[0]
        : null;
      if (!token) {
        // Without a download token the stored URL cannot be reconstructed, and
        // a record with no URL is worse than none: it would list in the media
        // library as a broken tile. Report it instead of guessing.
        skippedNoToken++;
        if (VERBOSE) console.log(`    ! no download token, skipped: ${file.name}`);
        continue;
      }

      const createdAt = custom.uploadedAt || custom.createdAt || file.metadata.timeCreated || new Date().toISOString();
      toCreate.push({
        id: assetIdForObject(file.name),
        type: assetTypeFor(file.metadata.contentType, type),
        storagePath: file.name,
        downloadUrl: buildDownloadUrl(bucket.name, file.name, token),
        mimeType: file.metadata.contentType || 'application/octet-stream',
        sizeBytes: size,
        width: null,
        height: null,
        originalFileName: custom.originalFileName || file.name.split('/').pop(),
        createdByType: custom.createdByType || 'user',
        createdById: custom.uploadedBy || custom.createdById || '',
        createdAt,
        refCount: 0,
        // Backfilled assets are never auto-collected. Reference counts are
        // unknown for history, and the sweep must not delete a customer's
        // media on the strength of a count this script invented.
        orphanedAt: null,
        backfilledAt: new Date().toISOString(),
      });
    }
  }

  if (!DRY_RUN && toCreate.length > 0) {
    for (let index = 0; index < toCreate.length; index += 450) {
      const batch = db.batch();
      for (const asset of toCreate.slice(index, index + 450)) {
        batch.set(db.doc(`workspaces/${workspaceId}/media_assets/${asset.id}`), asset, { merge: true });
      }
      await batch.commit();
    }
  }
  created = toCreate.length;

  const usageRef = db.doc(`usage/workspace:${workspaceId}`);
  const usageSnap = await usageRef.get();
  const storedBytes = Number(usageSnap.data()?.storageBytes) || 0;
  const drift = storedBytes - totalBytes;

  if (!DRY_RUN && !SKIP_USAGE && drift !== 0) {
    await usageRef.set({ storageBytes: totalBytes }, { merge: true });
  }

  return { workspaceId, objectCount, totalBytes, created, skippedNoToken, storedBytes, drift };
}

function formatBytes(bytes) {
  const abs = Math.abs(bytes);
  if (abs >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (abs >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (abs >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

async function main() {
  console.log(DRY_RUN ? '\nDRY RUN. Nothing will be written.\n' : '\nAPPLYING changes.\n');

  const workspaceIds = await listWorkspaceIds();
  console.log(`Reconciling ${workspaceIds.length} workspace(s).\n`);

  let totalCreated = 0;
  let totalDrift = 0;
  let totalNoToken = 0;
  const withDrift = [];

  for (const workspaceId of workspaceIds) {
    let result;
    try {
      result = await reconcileWorkspace(workspaceId);
    } catch (error) {
      console.log(`  ${workspaceId}: FAILED, ${error.message}`);
      continue;
    }

    totalCreated += result.created;
    totalDrift += result.drift;
    totalNoToken += result.skippedNoToken;
    if (result.drift !== 0) withDrift.push(result);

    if (result.objectCount > 0 || result.created > 0 || VERBOSE) {
      console.log(
        `  ${workspaceId}: ${result.objectCount} object(s), ` +
        `${result.created} record(s) to create, ` +
        `counted ${formatBytes(result.totalBytes)}, ` +
        `stored ${formatBytes(result.storedBytes)}` +
        (result.drift !== 0 ? `, over-counted by ${formatBytes(result.drift)}` : '') +
        (result.skippedNoToken > 0 ? `, ${result.skippedNoToken} skipped (no download token)` : ''),
      );
    }
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Asset records ${DRY_RUN ? 'to create' : 'created'}: ${totalCreated}`);
  console.log(`Objects skipped for want of a download token: ${totalNoToken}`);
  console.log(`Workspaces with a storage counter that disagrees: ${withDrift.length}`);
  console.log(`Net over-counted storage across all workspaces: ${formatBytes(totalDrift)}`);
  if (SKIP_USAGE) console.log('Usage counters left untouched (--skip-usage).');
  else if (DRY_RUN) console.log('Run without --dry-run to write the records and correct the counters.');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
