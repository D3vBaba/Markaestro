import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection, getMetaConnectionMerged, resolveUserAccessToken } from '@/lib/platform/connections';
import { listMetaCampaigns } from '@/lib/ads/meta-ads';
import { listTikTokCampaigns } from '@/lib/ads/tiktok-ads';
import { getMetaCampaignMetrics } from '@/lib/ads/meta-ads';
import { getTikTokCampaignMetrics } from '@/lib/ads/tiktok-ads';
import type { AdCampaignDoc } from '@/lib/ads/types';

/**
 * POST /api/ad-campaigns/import
 * Fetches all campaigns from the specified platform account, imports any that
 * don't already exist in Firestore (matched by externalCampaignId), and
 * immediately syncs their lifetime metrics.
 *
 * Body: { platform: 'meta' | 'tiktok', productId?: string }
 *
 * Returns: { imported, skipped, failed, campaigns[] }
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ads.write');

    const body = await req.json() as { platform: string; productId?: string };
    const { platform, productId } = body;

    if (!['meta', 'tiktok'].includes(platform)) {
      return apiOk({ ok: false, error: 'platform must be meta or tiktok' });
    }

    const ws = ctx.workspaceId;

    // ── 1. Load existing external campaign IDs to avoid duplicates ────
    const existingSnap = await adminDb
      .collection(`workspaces/${ws}/ad_campaigns`)
      .where('platform', '==', platform)
      .get();

    const existingExternalIds = new Set<string>(
      existingSnap.docs
        .map((d) => (d.data() as AdCampaignDoc).externalCampaignId)
        .filter(Boolean) as string[],
    );

    // ── 2. Fetch all campaigns from the platform ──────────────────────
    let platformCampaigns: Awaited<ReturnType<typeof listMetaCampaigns>>['campaigns'];

    if (platform === 'meta') {
      const conn = await getMetaConnectionMerged(ws, productId);
      if (!conn) return apiOk({ ok: false, error: 'Meta integration not connected' });

      // User access token is required — page tokens cannot list ad accounts
      const accessToken = resolveUserAccessToken(conn);

      // Fetch all ad accounts the user has access to
      const accountsRes = await fetch(
        'https://graph.facebook.com/v22.0/me/adaccounts?fields=id,name,account_status&limit=50',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const accountsData = await accountsRes.json() as {
        data?: Array<{ id: string; name: string; account_status: number }>;
        error?: { message: string };
      };

      if (accountsData.error) {
        return apiOk({ ok: false, error: `Meta API error: ${accountsData.error.message}` });
      }

      const activeAccounts = (accountsData.data || []).filter((a) => a.account_status === 1);
      if (activeAccounts.length === 0) {
        return apiOk({ ok: false, error: 'No active Meta ad accounts found for this user' });
      }

      // List campaigns from all ad accounts and merge
      const allCampaigns: typeof platformCampaigns = [];
      for (const account of activeAccounts) {
        const result = await listMetaCampaigns(accessToken, account.id);
        if (result.success && result.campaigns) {
          allCampaigns.push(...result.campaigns);
        }
      }
      platformCampaigns = allCampaigns;

    } else {
      // TikTok
      const conn = productId
        ? await getConnection(ws, 'tiktok_ads', productId) || await getConnection(ws, 'tiktok_ads')
        : await getConnection(ws, 'tiktok_ads');
      if (!conn) return apiOk({ ok: false, error: 'TikTok Ads integration not connected' });

      const accessToken = decrypt(conn.accessTokenEncrypted);
      const advertiserId = (conn.metadata.advertiserId as string) || '';
      if (!advertiserId) return apiOk({ ok: false, error: 'No TikTok advertiser ID configured on this connection' });

      const result = await listTikTokCampaigns(accessToken, advertiserId);
      if (!result.success) return apiOk({ ok: false, error: result.error });
      platformCampaigns = result.campaigns;
    }

    if (!platformCampaigns?.length) {
      return apiOk({ ok: true, imported: 0, skipped: 0, failed: 0, campaigns: [] });
    }

    // ── 3. Import new campaigns and sync their metrics ────────────────
    const now = new Date();
    const toImport = platformCampaigns
      .filter((c) => !existingExternalIds.has(c.externalCampaignId))
      .map((c) => ({
        ...c,
        // If the end date is in the past, mark as completed regardless of platform status
        status: (c.endDate && new Date(c.endDate) < now) ? 'completed' as const : c.status,
      }));
    const skipped = platformCampaigns.length - toImport.length;

    const results: { imported: number; failed: number; campaigns: Array<{ id: string; name: string; platform: string; status: string }> } = {
      imported: 0, failed: 0, campaigns: [],
    };

    // Process in batches of 10 to avoid hammering platform APIs
    const BATCH = 10;
    for (let i = 0; i < toImport.length; i += BATCH) {
      const batch = toImport.slice(i, i + BATCH);
      await Promise.all(batch.map(async (c) => {
        try {
          const now = new Date().toISOString();

          // Build a minimal but valid AdCampaignDoc
          const doc: AdCampaignDoc = {
            workspaceId: ws,
            name: c.name,
            platform: platform as 'meta' | 'tiktok',
            objective: c.objective as AdCampaignDoc['objective'],
            status: c.status as AdCampaignDoc['status'],
            dailyBudgetCents: c.dailyBudgetCents || 0,
            startDate: c.startDate ? new Date(c.startDate).toISOString() : now,
            endDate: c.endDate ? new Date(c.endDate).toISOString() : null,
            targeting: { ageMin: 18, ageMax: 65, gender: 'all', locations: [], interests: [], languages: [], devices: 'all', placements: 'automatic', keywords: [] },
            creative: { headline: '', primaryText: '', description: '', imageUrl: '', imageUrls: [], videoUrl: '', linkUrl: '', ctaType: '', additionalHeadlines: [], additionalDescriptions: [] },
            externalCampaignId: c.externalCampaignId,
            ...(platform === 'meta' && { productId }),
            ...(platform === 'tiktok' && { productId }),
            createdAt: now,
            updatedAt: now,
            createdBy: ctx.uid,
            launchedAt: now, // already live on the platform
          };

          const ref = await adminDb.collection(`workspaces/${ws}/ad_campaigns`).add(doc);

          // Immediately fetch lifetime metrics
          let metricsResult: Awaited<ReturnType<typeof getMetaCampaignMetrics>> | Awaited<ReturnType<typeof getTikTokCampaignMetrics>> | null = null;

          if (platform === 'meta') {
            const conn = await getMetaConnectionMerged(ws, productId);
            if (conn) {
              const accessToken = resolveUserAccessToken(conn);
              metricsResult = await getMetaCampaignMetrics(accessToken, c.externalCampaignId);
            }
          } else {
            const conn = productId
              ? await getConnection(ws, 'tiktok_ads', productId) || await getConnection(ws, 'tiktok_ads')
              : await getConnection(ws, 'tiktok_ads');
            if (conn) {
              const accessToken = decrypt(conn.accessTokenEncrypted);
              const advertiserId = (conn.metadata.advertiserId as string) || '';
              if (advertiserId) {
                metricsResult = await getTikTokCampaignMetrics(accessToken, advertiserId, c.externalCampaignId);
              }
            }
          }

          if (metricsResult?.success && metricsResult.metrics) {
            const today = new Date().toISOString().split('T')[0];
            await Promise.all([
              ref.update({ metrics: metricsResult.metrics }),
              ref.collection('metrics_history').doc(today).set({ ...metricsResult.metrics, date: today }),
            ]);
          }

          results.imported++;
          results.campaigns.push({ id: ref.id, name: c.name, platform, status: c.status });
        } catch {
          results.failed++;
        }
      }));
    }

    return apiOk({
      ok: true,
      imported: results.imported,
      skipped,
      failed: results.failed,
      campaigns: results.campaigns,
    });
  } catch (error) {
    return apiError(error);
  }
}
