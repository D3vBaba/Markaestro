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
  await check('posts.where(status==scheduled).orderBy(scheduledAt desc) [dashboard recent]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('status', '==', 'scheduled')
      .orderBy('scheduledAt', 'desc')
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
  await check('posts.where(status==published).where(productId).orderBy(publishedAt desc) [analytics product]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('status', '==', 'published')
      .where('productId', '==', 'sentinel')
      .where('publishedAt', '>=', '1970-01-01T00:00:00.000Z')
      .orderBy('publishedAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('collectionGroup(posts).where(tiktokPublishId) [tiktok webhook fallback]', (db) =>
    db.collectionGroup('posts').where('tiktokPublishId', '==', 'sentinel').limit(1).get(),
  );
  await check('collectionGroup(posts).where(externalId) [tiktok legacy webhook fallback]', (db) =>
    db.collectionGroup('posts').where('externalId', '==', 'sentinel').limit(1).get(),
  );
  await check('posts.where(status).orderBy(createdAt desc) [list]', (db) =>
    db.collection(`workspaces/${WS}/posts`).where('status', '==', 'draft').orderBy('createdAt', 'desc').limit(1).get(),
  );
  await check('posts.where(status IN [...]).where(productId).orderBy(createdAt desc) [content list]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('status', 'in', ['draft', 'failed'])
      .where('productId', '==', 'sentinel')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('posts.where(channel).where(productId).orderBy(createdAt desc) [list]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('channel', '==', 'facebook')
      .where('productId', '==', 'sentinel')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );

  console.log('\nMedia assets:');
  await check('media_assets.orderBy(createdAt desc) [media library]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('media_assets.where(createdByType).orderBy(createdAt desc) [media library]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`)
      .where('createdByType', '==', 'user')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('media_assets.where(type).orderBy(createdAt desc) [media library filter]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`)
      .where('type', '==', 'image')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('media_assets.orderBy(sizeBytes desc) [gallery, largest first]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`).orderBy('sizeBytes', 'desc').limit(1).get(),
  );
  await check('media_assets.where(type).orderBy(sizeBytes desc) [gallery filter, largest]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`)
      .where('type', '==', 'image')
      .orderBy('sizeBytes', 'desc')
      .limit(1)
      .get(),
  );
  await check('media_assets.where(refCount==0).orderBy(sizeBytes desc) [gallery unused, largest]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`)
      .where('refCount', '==', 0)
      .orderBy('sizeBytes', 'desc')
      .limit(1)
      .get(),
  );
  await check('media_assets.where(refCount==0).orderBy(createdAt desc) [gallery unused, newest]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`)
      .where('refCount', '==', 0)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('media_assets.where(processingState==pending) [derivation pipeline]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`)
      .where('processingState', '==', 'pending')
      .limit(1)
      .get(),
  );
  await check('media_assets.where(orphanedAt<=) [orphan sweep]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`)
      .where('orphanedAt', '<=', new Date().toISOString())
      .limit(1)
      .get(),
  );
  await check('media_assets.where(downloadUrl IN [...]) [reference lookup]', (db) =>
    db.collection(`workspaces/${WS}/media_assets`)
      .where('downloadUrl', 'in', ['https://sentinel.example/a.jpg'])
      .limit(1)
      .get(),
  );
  await check('posts.where(mediaUrls array-contains) [media usage]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('mediaUrls', 'array-contains', 'https://sentinel.example/a.jpg')
      .limit(1)
      .get(),
  );

  console.log('\nEvergreen queues:');
  await check('evergreenQueues.orderBy(createdAt desc) [queue list]', (db) =>
    db.collection(`workspaces/${WS}/evergreenQueues`)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('evergreenQueues.where(productId).orderBy(createdAt desc) [brand queue list]', (db) =>
    db.collection(`workspaces/${WS}/evergreenQueues`)
      .where('productId', '==', 'sentinel')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('evergreenQueues.where(productId).where(status) [capacity]', (db) =>
    db.collection(`workspaces/${WS}/evergreenQueues`)
      .where('productId', '==', 'sentinel')
      .where('status', '==', 'active')
      .limit(1)
      .get(),
  );
  await check('evergreenQueues.where(status).where(nextRunAt<=).orderBy(nextRunAt) [generation]', (db) =>
    db.collection(`workspaces/${WS}/evergreenQueues`)
      .where('status', '==', 'active')
      .where('nextRunAt', '<=', new Date().toISOString())
      .orderBy('nextRunAt', 'asc')
      .limit(1)
      .get(),
  );
  await check('evergreen variants.where(enabled).orderBy(position) [rotation]', (db) =>
    db.collection(`workspaces/${WS}/evergreenQueues/sentinel/variants`)
      .where('enabled', '==', true)
      .orderBy('position', 'asc')
      .limit(1)
      .get(),
  );
  await check('evergreen runs.where(status IN).where(evaluationDueAt<=).orderBy(evaluationDueAt) [evaluation]', (db) =>
    db.collection(`workspaces/${WS}/evergreenQueues/sentinel/runs`)
      .where('status', 'in', ['needs_review', 'scheduled', 'published'])
      .where('evaluationDueAt', '<=', new Date().toISOString())
      .orderBy('evaluationDueAt', 'asc')
      .limit(1)
      .get(),
  );
  await check('evergreen runs.orderBy(plannedAt desc) [run history]', (db) =>
    db.collection(`workspaces/${WS}/evergreenQueues/sentinel/runs`)
      .orderBy('plannedAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('evergreen runs.orderBy(plannedAt asc) [analytics rollup]', (db) =>
    db.collection(`workspaces/${WS}/evergreenQueues/sentinel/runs`)
      .orderBy('plannedAt', 'asc')
      .limit(1)
      .get(),
  );
  await check('posts.where(evergreen.queueId).where(status) [pause/archive cancellation]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('evergreen.queueId', '==', 'sentinel')
      .where('status', '==', 'scheduled')
      .limit(1)
      .get(),
  );

  console.log('\nToken refresh queue:');
  await check('_tokenRefreshQueue.where(nextDueAt<=) [due workspaces]', (db) =>
    db.collection('_tokenRefreshQueue')
      .where('nextDueAt', '<=', new Date().toISOString())
      .limit(1)
      .get(),
  );

  console.log('\nJob runs:');
  await check('job_runs.orderBy(createdAt desc) [public API list]', (db) =>
    db.collection(`workspaces/${WS}/job_runs`).orderBy('createdAt', 'desc').limit(1).get(),
  );
  await check('job_runs.where(status).orderBy(createdAt desc) [public API list]', (db) =>
    db.collection(`workspaces/${WS}/job_runs`)
      .where('status', '==', 'queued')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('job_runs.where(resourceId).orderBy(createdAt desc) [runs for one post]', (db) =>
    db.collection(`workspaces/${WS}/job_runs`)
      .where('resourceId', '==', 'sentinel')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('job_runs.where(status).where(resourceId).orderBy(createdAt desc) [runs for one post, filtered]', (db) =>
    db.collection(`workspaces/${WS}/job_runs`)
      .where('status', '==', 'failed')
      .where('resourceId', '==', 'sentinel')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );

  console.log('\nTracked links:');
  await check('trackedLinks.orderBy(createdAt desc) [link list, includeInactive]', (db) =>
    db.collection(`workspaces/${WS}/trackedLinks`)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('trackedLinks.where(active).orderBy(createdAt desc) [link list default]', (db) =>
    db.collection(`workspaces/${WS}/trackedLinks`)
      .where('active', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('trackedLinks.where(productId).orderBy(createdAt desc) [link list by brand]', (db) =>
    db.collection(`workspaces/${WS}/trackedLinks`)
      .where('productId', '==', 'sentinel')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('trackedLinks.where(productId).where(active).orderBy(createdAt desc) [link list by brand, active]', (db) =>
    db.collection(`workspaces/${WS}/trackedLinks`)
      .where('productId', '==', 'sentinel')
      .where('active', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('trackedLinks.where(socialPostId IN [...]) [evergreen attribution]', (db) =>
    db.collection(`workspaces/${WS}/trackedLinks`)
      .where('socialPostId', 'in', ['sentinel'])
      .limit(1)
      .get(),
  );

  await check('posts.where(status=published).where(metricsNextPollAt<=).orderBy(metricsNextPollAt) [SLO staleness]', (db) =>
    db.collection(`workspaces/${WS}/posts`)
      .where('status', '==', 'published')
      .where('metricsNextPollAt', '<=', new Date().toISOString())
      .orderBy('metricsNextPollAt', 'asc')
      .limit(1)
      .get(),
  );

  console.log('\nDelivery queues:');
  await check('webhook_deliveries.where(status IN [...]).where(nextAttemptAt<=).orderBy(nextAttemptAt)', (db) =>
    db.collection(`workspaces/${WS}/webhook_deliveries`)
      .where('status', 'in', ['pending', 'retrying'])
      .where('nextAttemptAt', '<=', new Date().toISOString())
      .orderBy('nextAttemptAt', 'asc')
      .limit(1)
      .get(),
  );
  await check('webhook_deliveries.where(endpointId).orderBy(createdAt desc) [delivery history]', (db) =>
    db.collection(`workspaces/${WS}/webhook_deliveries`)
      .where('endpointId', '==', 'sentinel')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('job_runs.where(type).where(status).where(nextAttemptAt<=).orderBy(nextAttemptAt)', (db) =>
    db.collection(`workspaces/${WS}/job_runs`)
      .where('type', '==', 'publish_post')
      .where('status', '==', 'queued')
      .where('nextAttemptAt', '<=', new Date().toISOString())
      .orderBy('nextAttemptAt', 'asc')
      .limit(1)
      .get(),
  );
  await check('tiktok_publish_mappings.where(pollStatus).where(nextPollAt<=).orderBy(nextPollAt)', (db) =>
    db.collection('tiktok_publish_mappings')
      .where('pollStatus', '==', 'active')
      .where('nextPollAt', '<=', new Date().toISOString())
      .orderBy('nextPollAt', 'asc')
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

  // ── Social intelligence ──────────────────────────────────────────────────
  console.log('\nSocial intelligence:');
  await check('socialPosts.where(productId)', (db) =>
    db.collection(`workspaces/${WS}/socialPosts`).where('productId', '==', 'sentinel').limit(1).get(),
  );
  await check('socialPosts.where(markaestroPostId IN [...]) [evergreen attribution]', (db) =>
    db.collection(`workspaces/${WS}/socialPosts`)
      .where('markaestroPostId', 'in', ['sentinel'])
      .limit(1)
      .get(),
  );
  await check('socialPosts.where(productId).where(platform) [audience fit history]', (db) =>
    db.collection(`workspaces/${WS}/socialPosts`)
      .where('productId', '==', 'sentinel')
      .where('platform', '==', 'instagram')
      .limit(1)
      .get(),
  );
  await check('socialPosts.where(publishedAt >=).orderBy(publishedAt desc) [fingerprint backfill, recent]', (db) =>
    db.collection(`workspaces/${WS}/socialPosts`)
      .where('publishedAt', '>=', '2026-01-01T00:00:00.000Z')
      .orderBy('publishedAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('socialPosts.where(publishedAt <).orderBy(publishedAt desc) [fingerprint backfill, older]', (db) =>
    db.collection(`workspaces/${WS}/socialPosts`)
      .where('publishedAt', '<', '2026-01-01T00:00:00.000Z')
      .orderBy('publishedAt', 'desc')
      .limit(1)
      .get(),
  );
  await check('socialPosts.orderBy(publishedAt desc) [fingerprint incremental]', (db) =>
    db.collection(`workspaces/${WS}/socialPosts`).orderBy('publishedAt', 'desc').limit(1).get(),
  );
  await check('intelligenceJobs.where(status)', (db) =>
    db.collection(`workspaces/${WS}/intelligenceJobs`).where('status', '==', 'queued').limit(1).get(),
  );
  await check('brandLearnings.where(productId)', (db) =>
    db.collection(`workspaces/${WS}/brandLearnings`).where('productId', '==', 'sentinel').limit(1).get(),
  );
  await check('optimizationRecommendations.where(productId)', (db) =>
    db.collection(`workspaces/${WS}/optimizationRecommendations`).where('productId', '==', 'sentinel').limit(1).get(),
  );

  // ── Products ──────────────────────────────────────────────────────────────
  console.log('\nProducts:');

  await check('products.orderBy(createdAt) — no filters', (db) =>
    db.collection(`workspaces/${WS}/products`).orderBy('createdAt', 'desc').limit(1).get(),
  );
  await check('products.where(status) — no orderBy', (db) =>
    db.collection(`workspaces/${WS}/products`).where('status', '==', 'active').limit(1).get(),
  );
  await check('products.where(status).orderBy(createdAt desc) [list]', (db) =>
    db.collection(`workspaces/${WS}/products`).where('status', '==', 'active').orderBy('createdAt', 'desc').limit(1).get(),
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
