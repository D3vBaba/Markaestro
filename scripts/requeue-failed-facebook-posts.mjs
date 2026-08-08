/**
 * Requeue Facebook posts that failed because their recorded destination could
 * not be resolved.
 *
 * Sets each post back to `scheduled` with `scheduledAt` in the past so the
 * normal worker claims it on its next tick, and flags
 * `retryFailedChannelsOnly` so a partially-successful multi-channel post does
 * not publish twice to the channels that already went out.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   node scripts/requeue-failed-facebook-posts.mjs            # preview
 *   node scripts/requeue-failed-facebook-posts.mjs --apply
 *   node scripts/requeue-failed-facebook-posts.mjs --apply --hours 48
 *   node scripts/requeue-failed-facebook-posts.mjs --apply --exclude id1,id2
 */
import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APPLY = process.argv.includes('--apply');
const hoursArg = process.argv.indexOf('--hours');
const HOURS = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : 24;
// Post ids to leave alone, e.g. the second copy of a double-scheduled post.
const excludeArg = process.argv.indexOf('--exclude');
const EXCLUDE = new Set(
  excludeArg > -1 ? String(process.argv[excludeArg + 1] || '').split(',').map((id) => id.trim()).filter(Boolean) : [],
);

const envPath = resolve(process.cwd(), '.env.local');
const raw = readFileSync(envPath, 'utf8');
for (const line of raw.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  if (!process.env[m[1]]) {
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

function resolveCredential() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim().startsWith('{')) return admin.credential.cert(JSON.parse(json));
  return admin.credential.applicationDefault();
}

admin.initializeApp({
  credential: resolveCredential(),
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'markaestro-0226220726',
});
const db = admin.firestore();

const since = new Date(Date.now() - HOURS * 60 * 60 * 1000).toISOString();
const nowIso = new Date().toISOString();
// A minute in the past so the very next worker tick picks it up.
const dueAt = new Date(Date.now() - 60 * 1000).toISOString();

let considered = 0;
let requeued = 0;
let skipped = 0;

const workspaces = await db.collection('workspaces').get();

for (const ws of workspaces.docs) {
  const wsId = ws.id;
  const products = await db.collection(`workspaces/${wsId}/products`).get();
  const productNames = new Map(products.docs.map((d) => [d.id, d.data().name || d.id]));

  // Which Facebook Pages this workspace can actually publish to right now.
  const connectedPages = new Map();
  for (const product of products.docs) {
    const conns = await db
      .collection(`workspaces/${wsId}/products/${product.id}/platformConnections`)
      .get();
    for (const c of conns.docs) {
      const d = c.data();
      if (d.provider !== 'meta' || d.status !== 'connected') continue;
      if (!d.metadata?.pageAccessTokenEncrypted) continue;
      connectedPages.set(product.id, d.metadata.pageName || d.metadata.pageId);
    }
  }

  const posts = await db.collection(`workspaces/${wsId}/posts`)
    .where('updatedAt', '>=', since)
    .get();

  for (const doc of posts.docs) {
    const post = doc.data();
    if (!['failed', 'partial_failed'].includes(post.status)) continue;

    const channels = Array.isArray(post.targetChannels) && post.targetChannels.length
      ? post.targetChannels
      : [post.channel];
    if (!channels.includes('facebook')) continue;

    considered++;
    const productName = productNames.get(post.productId) ?? post.productId ?? '-';

    if (EXCLUDE.has(doc.id)) {
      console.log(`HOLD  ${doc.id} [${productName}] — excluded by --exclude`);
      skipped++;
      continue;
    }

    // Only worth retrying if the brand has a publishable Page — otherwise the
    // retry would fail again for a different, real reason.
    if (!post.productId || !connectedPages.has(post.productId)) {
      console.log(`SKIP  ${doc.id} [${productName}] — no connected Facebook Page for this brand`);
      skipped++;
      continue;
    }

    console.log(
      `RETRY ${doc.id} [${productName}] → ${connectedPages.get(post.productId)}\n` +
      `      was: ${post.status} · originally scheduled ${post.scheduledAt ?? '-'}\n` +
      `      content: ${JSON.stringify(String(post.content ?? '').replace(/\s+/g, ' ').slice(0, 70))}`,
    );

    if (APPLY) {
      await doc.ref.update({
        status: 'scheduled',
        scheduledAt: dueAt,
        retryFailedChannelsOnly: true,
        errorMessage: admin.firestore.FieldValue.delete(),
        publishAttemptCount: 0,
        publishAttemptId: admin.firestore.FieldValue.delete(),
        publishLeaseExpiresAt: admin.firestore.FieldValue.delete(),
        publishRetryAt: admin.firestore.FieldValue.delete(),
        updatedAt: nowIso,
      });
      requeued++;
    }
  }
}

console.log(
  `\n${APPLY ? 'Requeued' : 'Would requeue'}: ${APPLY ? requeued : considered - skipped}` +
  ` · skipped: ${skipped} · considered: ${considered}`,
);
if (!APPLY) console.log('Dry run — re-run with --apply to write.');

process.exit(0);
