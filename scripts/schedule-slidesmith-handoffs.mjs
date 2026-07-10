/**
 * Promote SlideSmith's locally planned TikTok handoffs into Markaestro's
 * scheduled queue. Dry-run by default; pass --apply to write.
 *
 * The script derives the workspace/client from SlideSmith's saved Markaestro
 * key, verifies ownership/product/media for every post, and then writes only
 * the scheduling fields needed by Markaestro's existing worker.
 */
import admin from 'firebase-admin';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const slideSmithDir = process.env.SLIDESMITH_DIR || join(homedir(), '.slidesmith');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseKey(token) {
  if (!String(token).startsWith('mk_live_')) throw new Error('Active SlideSmith project has no Markaestro live key.');
  const [workspaceId, clientId] = String(token).slice('mk_live_'.length).split('.');
  if (!workspaceId || !clientId) throw new Error('Could not parse the saved Markaestro key.');
  return { workspaceId, clientId };
}

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT;
  if (raw?.startsWith('{')) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)), projectId });
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  }
}

async function main() {
  const config = readJson(join(slideSmithDir, 'config.json'));
  const active = config.projects?.find((project) => project.id === config.activeProjectId);
  if (!active) throw new Error('SlideSmith active project was not found.');

  const { workspaceId, clientId } = parseKey(active.markaestro?.apiKey);
  const allPlans = readJson(join(slideSmithDir, 'handoffs.json'));
  const plans = allPlans
    .filter((plan) => plan.projectId === active.id && plan.delivery === 'manual_handoff')
    .sort((a, b) => String(a.intendedAt).localeCompare(String(b.intendedAt)));
  if (!plans.length) throw new Error(`No SlideSmith handoff plans found for ${active.name}.`);

  const postIds = plans.map((plan) => String(plan.postId));
  if (new Set(postIds).size !== postIds.length) throw new Error('Duplicate post IDs found in SlideSmith handoffs.');

  initAdmin();
  const db = admin.firestore();
  const clientSnap = await db.doc(`workspaces/${workspaceId}/api_clients/${clientId}`).get();
  if (!clientSnap.exists) throw new Error('The saved Markaestro API client no longer exists.');
  const client = clientSnap.data();
  if (client.status !== 'active') throw new Error('The saved Markaestro API client is not active.');

  const refs = postIds.map((postId) => db.doc(`workspaces/${workspaceId}/posts/${postId}`));
  const snaps = await db.getAll(...refs);
  const byId = new Map(snaps.map((snap) => [snap.id, snap]));
  const problems = [];

  for (const plan of plans) {
    const snap = byId.get(String(plan.postId));
    const post = snap?.data() || {};
    const intendedAt = new Date(plan.intendedAt);
    if (!snap?.exists) problems.push(`${plan.queueId}: remote post is missing`);
    else if (post.createdById !== clientId) problems.push(`${plan.queueId}: API client ownership does not match`);
    else if (client.productId && post.productId !== client.productId) problems.push(`${plan.queueId}: product does not match the API key`);
    else if (post.channel !== 'tiktok') problems.push(`${plan.queueId}: expected TikTok, found ${post.channel}`);
    else if (!['draft', 'scheduled'].includes(post.status)) problems.push(`${plan.queueId}: status ${post.status} is not schedulable`);
    else if (!Array.isArray(post.mediaUrls) || post.mediaUrls.length < 1) problems.push(`${plan.queueId}: no remote media`);
    else if (Number.isNaN(intendedAt.getTime())) problems.push(`${plan.queueId}: invalid intended time`);
  }

  if (problems.length) {
    throw new Error(`Preflight failed:\n- ${problems.join('\n- ')}`);
  }

  const first = plans[0].intendedAt;
  const last = plans.at(-1).intendedAt;
  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    slideSmithProject: active.name,
    workspaceId,
    productId: client.productId || null,
    posts: plans.length,
    first,
    last,
  }, null, 2));

  if (!APPLY) {
    console.log('\nNo writes made. Re-run with --apply after reviewing this preflight.');
    return;
  }

  const batch = db.batch();
  const updatedAt = new Date().toISOString();
  for (const plan of plans) {
    const intendedAt = new Date(plan.intendedAt).toISOString();
    batch.set(db.doc(`workspaces/${workspaceId}/posts/${plan.postId}`), {
      status: 'scheduled',
      scheduledAt: intendedAt,
      originalScheduledAt: intendedAt,
      deliveryMode: 'platform_inbox',
      sourceType: 'slidesmith',
      slideshowId: plan.queueId || '',
      updatedAt,
    }, { merge: true });
  }
  await batch.commit();
  console.log(`\nScheduled ${plans.length} TikTok inbox handoffs.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
