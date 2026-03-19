import { adminDb } from '@/lib/firebase-admin';
import { sendCampaignEmails } from '@/lib/email/sender';
import { publishPostMultiChannel } from '@/lib/social/publisher';
import { decrypt } from '@/lib/crypto';
import { getMetaCampaignMetrics } from '@/lib/ads/meta-ads';
import { getGoogleCampaignMetrics } from '@/lib/ads/google-ads';
import { getConnection, getMetaConnectionMerged, resolveUserAccessToken } from '@/lib/platform/connections';
import { JobDoc } from './types';

export async function executeJob(workspaceId: string, jobId: string, job: JobDoc) {
  const startedAt = new Date().toISOString();
  const runRef = await adminDb.collection(`workspaces/${workspaceId}/job_runs`).add({
    workspaceId,
    jobId,
    status: 'started',
    message: 'Job execution started',
    startedAt,
  });

  try {
    let message = 'No-op';
    let details: Record<string, unknown> = {};

    if (job.type === 'send_email_campaign') {
      const campaignId = job.payload?.campaignId as string;
      if (!campaignId) {
        message = 'No campaignId in job payload — skipped';
      } else {
        const campaignSnap = await adminDb
          .doc(`workspaces/${workspaceId}/campaigns/${campaignId}`)
          .get();
        if (!campaignSnap.exists) {
          message = `Campaign ${campaignId} not found`;
        } else {
          const campaign = campaignSnap.data()!;
          const result = await sendCampaignEmails(workspaceId, {
            name: campaign.name,
            subject: campaign.subject,
            body: campaign.body,
            cta: campaign.cta,
            targetAudience: campaign.targetAudience,
            productId: campaign.productId,
          });
          message = `Email campaign "${campaign.name}": ${result.sent} sent, ${result.failed} failed`;
          details = result;
        }
      }
    } else if (job.type === 'sync_contacts') {
      const contactsSnap = await adminDb
        .collection(`workspaces/${workspaceId}/contacts`)
        .get();
      message = `Contacts sync completed: ${contactsSnap.size} contacts in workspace`;
      details = { contactCount: contactsSnap.size };
    } else if (job.type === 'generate_content') {
      message = 'Content generation requires AI integration — configure Claude API key in settings';
    } else if (job.type === 'publish_post') {
      const postId = job.payload?.postId as string;
      if (!postId) {
        message = 'No postId in job payload — skipped';
      } else {
        const postSnap = await adminDb
          .doc(`workspaces/${workspaceId}/posts/${postId}`)
          .get();
        if (!postSnap.exists) {
          message = `Post ${postId} not found`;
        } else {
          const post = postSnap.data()!;
          const productId = post.productId as string | undefined;
          if (!productId) {
            message = `Post ${postId} has no associated product — skipped`;
          } else {
            const result = await publishPostMultiChannel(workspaceId, productId, {
              content: post.content,
              channel: post.channel,
              mediaUrls: post.mediaUrls,
            });
            const successfulChannels = result.channels.filter((c) => c.success);
            if (result.success) {
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: 'published',
                externalId: result.externalId || '',
                externalUrl: result.externalUrl || '',
                publishResults: result.channels,
                publishedChannels: successfulChannels.map((c) => c.channel),
                publishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
              message = `Post published to ${successfulChannels.map((c) => c.channel).join(' & ')}`;
            } else {
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: 'failed',
                errorMessage: result.error || 'Unknown error',
                publishResults: result.channels,
                updatedAt: new Date().toISOString(),
              });
              message = `Post publish failed: ${result.error}`;
            }
            details = result;
          }
        }
      }
    } else if (job.type === 'create_ad_campaign') {
      const adCampaignId = job.payload?.adCampaignId as string;
      if (!adCampaignId) {
        message = 'No adCampaignId in job payload — skipped';
      } else {
        message = `Ad campaign ${adCampaignId} — use the launch endpoint to create on platform`;
        details = { adCampaignId };
      }
    } else if (job.type === 'sync_ad_metrics') {
      const adSnap = await adminDb
        .collection(`workspaces/${workspaceId}/ad_campaigns`)
        .where('status', 'in', ['active', 'paused'])
        .get();

      let synced = 0;
      let failed = 0;

      for (const doc of adSnap.docs) {
        const campaign = doc.data();
        if (!campaign.externalCampaignId) continue;

        try {
          let metricsResult: { success: boolean; metrics?: Record<string, unknown>; error?: string } | undefined;

          if (campaign.platform === 'meta' && campaign.productId) {
            const conn = await getMetaConnectionMerged(workspaceId, campaign.productId);
            if (conn) {
              const token = resolveUserAccessToken(conn);
              metricsResult = await getMetaCampaignMetrics(token, campaign.externalCampaignId);
            }
          } else if (campaign.platform === 'google') {
            const conn = await getConnection(workspaceId, 'google');
            if (conn) {
              const token = decrypt(conn.accessTokenEncrypted);
              metricsResult = await getGoogleCampaignMetrics(
                token,
                conn.metadata.customerId as string,
                process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
                campaign.externalCampaignId,
                conn.metadata.loginCustomerId as string | undefined,
              );
            }
          }

          if (metricsResult?.success && metricsResult.metrics) {
            await adminDb.doc(`workspaces/${workspaceId}/ad_campaigns/${doc.id}`).update({
              metrics: metricsResult.metrics,
              updatedAt: new Date().toISOString(),
            });
            synced++;
          } else if (metricsResult && !metricsResult.success) {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      message = `Ad metrics sync: ${synced} synced, ${failed} failed out of ${adSnap.size} campaigns`;
      details = { total: adSnap.size, synced, failed };
    } else if (job.type === 'refresh_tokens') {
      message = 'Token refresh handled by worker tick directly';
    }

    const finishedAt = new Date().toISOString();
    await runRef.update({ status: 'success', message, details, finishedAt });

    const next = computeNextRun(job.schedule, job.hourUTC, job.minuteUTC);
    await adminDb.doc(`workspaces/${workspaceId}/jobs/${jobId}`).update({
      lastRunAt: finishedAt,
      nextRunAt: next,
      updatedAt: finishedAt,
    });

    return { ok: true, message, details, runId: runRef.id };
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : 'Unknown error';
    const finishedAt = new Date().toISOString();
    await runRef.update({ status: 'failed', message: errorMsg, finishedAt });
    return { ok: false, error: errorMsg, runId: runRef.id };
  }
}

export function computeNextRun(schedule: 'manual' | 'daily', hourUTC = 15, minuteUTC = 0) {
  if (schedule === 'manual') return null;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUTC, minuteUTC, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
