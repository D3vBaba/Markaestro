/**
 * One-off projection of published `posts` into canonical `socialPosts`.
 *
 * Intelligence Overview reads `socialPosts` only. Dual-write from the metrics
 * poller happens on live fetches, so already-complete posts never appeared.
 * This script is idempotent and safe to re-run.
 *
 *   GOOGLE_CLOUD_PROJECT=markaestro-0226220726 npx tsx scripts/backfill-legacy-social-posts.ts default
 */

const workspaceId = process.argv[2] || 'default';

async function main() {
  process.env.GOOGLE_CLOUD_PROJECT ||= process.env.GCLOUD_PROJECT
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    || 'markaestro-0226220726';

  const { backfillLegacySocialPosts } = await import('../src/lib/intelligence/legacy-post-backfill');
  const { adminDb } = await import('../src/lib/firebase-admin');

  let afterId: string | undefined;
  let pages = 0;
  let written = 0;
  let scanned = 0;
  let skippedNoTarget = 0;
  let skippedNoConnection = 0;

  while (true) {
    const page = await backfillLegacySocialPosts(workspaceId, new Date().toISOString(), {
      afterId,
      limit: 200,
    });
    pages += 1;
    written += page.written;
    scanned += page.scanned;
    skippedNoTarget += page.skippedNoTarget;
    skippedNoConnection += page.skippedNoConnection;
    console.log(JSON.stringify({ pages, ...page }));
    if (page.done) break;
    if (!page.lastId || page.lastId === afterId) {
      throw new Error('BACKFILL_CURSOR_STALLED');
    }
    afterId = page.lastId;
  }

  await adminDb.doc(`workspaces/${workspaceId}/analytics/meta`).set({
    socialPostsBackfillAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  console.log(JSON.stringify({
    workspaceId,
    pages,
    scanned,
    written,
    skippedNoTarget,
    skippedNoConnection,
    done: true,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
