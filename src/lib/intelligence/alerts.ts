import { adminDb } from '@/lib/firebase-admin';
import { createInboxItem } from '@/lib/inbox';
import { logger } from '@/lib/logger';
import { loadProductIntelligence } from './product-state';
import { detectAnomalies } from './pulse';

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function isoWeek(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}w${String(week).padStart(2, '0')}`;
}

/** Owners and admins, the people who act on a brand-level alert. */
export async function listWorkspaceNotifiableUids(workspaceId: string): Promise<string[]> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/members`)
    .where('role', 'in', ['owner', 'admin'])
    .limit(5)
    .get();
  return snap.docs.map((doc) => String(doc.data()?.uid ?? doc.id)).filter(Boolean);
}

/**
 * Once a day, look at every brand's measured posts for something a human
 * would want to hear about today: a post taking off, or a channel that has
 * gone quiet. Alerts land in the inbox with fixed ids so a repeat scan is a
 * no-op.
 */
export async function runIntelligenceAlerts(workspaceId: string, now = new Date()): Promise<{ alerts: number; skipped: boolean }> {
  const stateRef = adminDb.doc(`workspaces/${workspaceId}/intelligenceState/alerts`);
  const state = await stateRef.get();
  const lastRunAt = state.exists ? Date.parse(String(state.data()?.lastRunAt ?? '')) : Number.NaN;
  if (Number.isFinite(lastRunAt) && now.getTime() - lastRunAt < RUN_INTERVAL_MS) return { alerts: 0, skipped: true };
  await stateRef.set({ lastRunAt: now.toISOString() }, { merge: true });

  const [products, uids] = await Promise.all([
    adminDb.collection(`workspaces/${workspaceId}/products`).limit(100).get(),
    listWorkspaceNotifiableUids(workspaceId),
  ]);
  if (uids.length === 0) return { alerts: 0, skipped: false };

  let alerts = 0;
  for (const product of products.docs) {
    const name = String(product.data()?.name ?? 'Untitled brand');
    let anomalies: ReturnType<typeof detectAnomalies>;
    try {
      const loaded = await loadProductIntelligence(workspaceId, product.id, { allowCached: true });
      anomalies = detectAnomalies(loaded.insights.rollup.measuredPosts, now);
    } catch (error) {
      logger.warn('intelligence alerts skipped a brand', { event: 'intelligence.alerts.brand_failed', workspaceId, productId: product.id, err: error });
      continue;
    }
    for (const anomaly of anomalies) {
      const shared = anomaly.kind === 'viral'
        ? {
            id: `alert_viral_${anomaly.postId}`,
            title: `A ${name} post is taking off`,
            body: `It has ${anomaly.views.toLocaleString('en-US')} views on ${anomaly.platform}, ${anomaly.multiple}x your usual. Consider boosting it, replying to comments, or making it evergreen.`,
            href: `/evergreen?brand=${encodeURIComponent(product.id)}&source=${encodeURIComponent(anomaly.postId)}`,
            meta: { kind: 'viral', productId: product.id, postId: anomaly.postId, platform: anomaly.platform },
          }
        : {
            id: `alert_quiet_${product.id}_${anomaly.platform}_${isoWeek(now)}`,
            title: `${name} has gone quiet on ${anomaly.platform}`,
            body: `Nothing has been published there for ${anomaly.daysSilent} days. Schedule something or pause the channel on purpose.`,
            href: `/content?brand=${encodeURIComponent(product.id)}`,
            meta: { kind: 'quiet_channel', productId: product.id, platform: anomaly.platform, daysSilent: anomaly.daysSilent },
          };
      for (const uid of uids) {
        await createInboxItem({ ...shared, id: `${shared.id}_${uid}`, workspaceId, uid, type: 'system' });
        alerts += 1;
      }
    }
  }
  return { alerts, skipped: false };
}
