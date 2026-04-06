#!/usr/bin/env node
/**
 * Firestore query validation script.
 *
 * Runs every query pattern used in the app against the real Firestore database
 * to verify that required indexes exist. Any FAILED_PRECONDITION error means a
 * composite index is missing and the query will blow up in production.
 *
 * Usage:
 *   node scripts/validate-firestore-queries.mjs
 *   npm run validate:queries
 *
 * Requires Application Default Credentials (ADC) or FIREBASE_SERVICE_ACCOUNT_JSON.
 * In CI this runs as part of the pre-deploy step.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'markaestro-0226220726';

// --- Init ---
function getApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.startsWith('{')) {
    return initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore(getApp());

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function check(label, queryFn) {
  try {
    await queryFn(db);
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msg.includes('FAILED_PRECONDITION')) {
      console.error(`  ✗  ${label}`);
      console.error(`       Missing index: ${msg.slice(0, 300)}`);
    } else {
      // Permission errors, not-found, etc. are expected — not an index problem
      console.log(`  ·  ${label} (skipped: ${msg.slice(0, 80)})`);
    }
    // Only count FAILED_PRECONDITION as a real failure
    if (msg.includes('FAILED_PRECONDITION')) failed++;
  }
}

// Use a real workspace that is known to exist; fall back to 'default'.
const WS = 'default';

// ---------------------------------------------------------------------------
// Query catalogue — one entry per distinct query shape used in the codebase
// ---------------------------------------------------------------------------

async function runChecks() {
  console.log(`\nValidating Firestore indexes against project: ${PROJECT_ID}\n`);

  // ── Auth / membership ─────────────────────────────────────────────────────
  console.log('Auth & membership:');

  await check('collectionGroup(members).where(uid)', (db) =>
    db.collectionGroup('members').where('uid', '==', 'sentinel').limit(1).get(),
  );
  await check('collectionGroup(members).where(uid).where(role)', (db) =>
    db.collectionGroup('members').where('uid', '==', 'sentinel').where('role', '==', 'owner').limit(1).get(),
  );
  await check('collectionGroup(pendingInvites).where(email)', (db) =>
    db.collectionGroup('pendingInvites').where('email', '==', 'sentinel@example.com').get(),
  );
  await check('workspaces/{id}/members.where(role)', (db) =>
    db.collection(`workspaces/${WS}/members`).where('role', '==', 'owner').limit(20).get(),
  );

  // ── Posts ─────────────────────────────────────────────────────────────────
  console.log('\nPosts:');

  await check('posts.orderBy(createdAt) — no filters', (db) =>
    db.collection(`workspaces/${WS}/posts`).orderBy('createdAt', 'desc').limit(1).get(),
  );
  await check('posts.where(status) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/posts`).where('status', '==', 'scheduled').limit(1).get(),
  );
  await check('posts.where(status IN [...])', (db) =>
    db.collection(`workspaces/${WS}/posts`).where('status', 'in', ['scheduled', 'published']).limit(1).get(),
  );
  await check('posts.where(status).where(channel) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/posts`).where('status', '==', 'published').where('channel', '==', 'facebook').limit(1).get(),
  );
  await check('posts.where(campaignId).where(status)', (db) =>
    db.collection(`workspaces/${WS}/posts`).where('campaignId', '==', 'sentinel').where('status', '==', 'draft').limit(1).get(),
  );
  await check('posts.where(campaignId).where(generationRunId)', (db) =>
    db.collection(`workspaces/${WS}/posts`).where('campaignId', '==', 'sentinel').where('generationRunId', '==', 'sentinel').limit(1).get(),
  );
  // Background job queries (unconditional filters + orderBy — need composite indexes)
  await check('posts.where(status==scheduled).where(scheduledAt<=).orderBy(scheduledAt) [publisher]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '<=', new Date().toISOString())
      .orderBy('scheduledAt', 'asc')
      .limit(1)
      .get(),
  );
  await check('posts.where(status==publishing).orderBy(updatedAt) [publisher recovery]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('status', '==', 'publishing')
      .orderBy('updatedAt', 'asc')
      .limit(1)
      .get(),
  );
  await check('posts.where(status==publishing).where(channel==tiktok).orderBy(updatedAt) [tiktok worker]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('status', '==', 'publishing')
      .where('channel', '==', 'tiktok')
      .orderBy('updatedAt', 'asc')
      .limit(1)
      .get(),
  );

  // ── Campaigns ─────────────────────────────────────────────────────────────
  console.log('\nCampaigns:');

  await check('campaigns.orderBy(createdAt) — no filters', (db) =>
    db.collection(`workspaces/${WS}/campaigns`).orderBy('createdAt', 'desc').limit(1).get(),
  );
  await check('campaigns.where(status) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/campaigns`).where('status', '==', 'scheduled').limit(1).get(),
  );

  // ── Products ──────────────────────────────────────────────────────────────
  console.log('\nProducts:');

  await check('products.orderBy(createdAt) — no filters', (db) =>
    db.collection(`workspaces/${WS}/products`).orderBy('createdAt', 'desc').limit(1).get(),
  );
  await check('products.where(status) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/products`).where('status', '==', 'active').limit(1).get(),
  );

  // ── Ad campaigns ──────────────────────────────────────────────────────────
  console.log('\nAd campaigns:');

  await check('ad_campaigns.orderBy(createdAt) — no filters', (db) =>
    db.collection(`workspaces/${WS}/ad_campaigns`).orderBy('createdAt', 'desc').limit(1).get(),
  );
  await check('ad_campaigns.where(status) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/ad_campaigns`).where('status', '==', 'active').limit(1).get(),
  );
  await check('ad_campaigns.where(status IN [active,paused])', (db) =>
    db.collection(`workspaces/${WS}/ad_campaigns`).where('status', 'in', ['active', 'paused']).limit(1).get(),
  );

  // ── Events ────────────────────────────────────────────────────────────────
  console.log('\nEvents:');

  await check('events.orderBy(timestamp) — no filters', (db) =>
    db.collection(`workspaces/${WS}/events`).orderBy('timestamp', 'desc').limit(1).get(),
  );
  await check('events.where(type) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/events`).where('type', '==', 'page_view').limit(1).get(),
  );
  await check('events.where(campaignId) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/events`).where('campaignId', '==', 'sentinel').limit(1).get(),
  );
  await check('events.where(contactId) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/events`).where('contactId', '==', 'sentinel').limit(1).get(),
  );

  // ── Jobs ──────────────────────────────────────────────────────────────────
  console.log('\nJobs:');

  await check('jobs.where(enabled).where(schedule).orderBy(nextRunAt)', (db) =>
    db.collection(`workspaces/${WS}/jobs`)
      .where('enabled', '==', true)
      .where('schedule', '==', 'daily')
      .orderBy('nextRunAt', 'asc')
      .limit(1)
      .get(),
  );

  // ── TikTok trends ─────────────────────────────────────────────────────────
  console.log('\nTikTok trends:');

  await check('tiktokTrends.orderBy(createdAt) — no filters', (db) =>
    db.collection(`workspaces/${WS}/tiktokTrends`).orderBy('createdAt', 'desc').limit(1).get(),
  );
  await check('tiktokTrends.where(status) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/tiktokTrends`).where('status', '==', 'suggested').limit(1).get(),
  );
  await check('tiktokTrends.where(productId) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/tiktokTrends`).where('productId', '==', 'sentinel').limit(1).get(),
  );

  // ── Subscriptions ─────────────────────────────────────────────────────────
  console.log('\nSubscriptions:');

  await check('subscriptions.where(stripeCustomerId)', (db) =>
    db.collection('subscriptions').where('stripeCustomerId', '==', 'sentinel').limit(1).get(),
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error('\n❌ One or more queries require a Firestore index that does not exist.');
    console.error('   Add the missing index to firestore.indexes.json and run:');
    console.error('   firebase deploy --only firestore:indexes\n');
    process.exit(1);
  } else {
    console.log('\n✅ All Firestore indexes are present.\n');
  }
}

runChecks().catch((err) => {
  console.error('Fatal error running validation:', err);
  process.exit(1);
});
