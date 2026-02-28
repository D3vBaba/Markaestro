import { adminDb } from '@/lib/firebase-admin';
import { sendCampaignEmails } from '@/lib/email/sender';

export type AutomationStep = {
  id: string;
  action: string;
  config: Record<string, unknown>;
  delayMinutes: number;
};

type StepResult = {
  stepId: string;
  action: string;
  status: 'success' | 'failed' | 'skipped';
  message: string;
};

/**
 * Execute all steps in an automation workflow for a given contact.
 */
export async function executeAutomation(
  workspaceId: string,
  automationId: string,
  contactId: string,
  steps: AutomationStep[],
): Promise<{ results: StepResult[] }> {
  const results: StepResult[] = [];

  // Get the contact
  const contactSnap = await adminDb
    .doc(`workspaces/${workspaceId}/contacts/${contactId}`)
    .get();

  if (!contactSnap.exists) {
    return {
      results: [{
        stepId: 'pre-check',
        action: 'validate',
        status: 'failed',
        message: `Contact ${contactId} not found`,
      }],
    };
  }

  const contact = contactSnap.data()!;

  for (const step of steps) {
    try {
      const result = await executeStep(workspaceId, step, contact, contactId);
      results.push(result);

      // Stop on failure
      if (result.status === 'failed') break;
    } catch (err) {
      results.push({
        stepId: step.id,
        action: step.action,
        status: 'failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      break;
    }
  }

  // Log automation run
  await adminDb.collection(`workspaces/${workspaceId}/automation_runs`).add({
    automationId,
    contactId,
    results,
    status: results.every((r) => r.status === 'success') ? 'success' : 'failed',
    timestamp: new Date().toISOString(),
  });

  return { results };
}

async function executeStep(
  workspaceId: string,
  step: AutomationStep,
  contact: Record<string, unknown>,
  contactId: string,
): Promise<StepResult> {
  switch (step.action) {
    case 'send_email': {
      const subject = String(step.config.subject || 'Hello from Markaestro');
      const body = String(step.config.body || '');
      const result = await sendCampaignEmails(workspaceId, {
        name: `Automation: ${subject}`,
        subject,
        body,
      }, {
        testMode: true,
        testEmail: contact.email as string,
      });
      return {
        stepId: step.id,
        action: step.action,
        status: result.sent > 0 ? 'success' : 'failed',
        message: `Email ${result.sent > 0 ? 'sent' : 'failed'} to ${contact.email}`,
      };
    }

    case 'update_tag': {
      const tag = String(step.config.tag || '');
      const operation = String(step.config.operation || 'add');
      if (!tag) return { stepId: step.id, action: step.action, status: 'skipped', message: 'No tag specified' };

      const currentTags = (contact.tags as string[]) || [];
      const newTags = operation === 'remove'
        ? currentTags.filter((t) => t !== tag)
        : [...new Set([...currentTags, tag])];

      await adminDb.doc(`workspaces/${workspaceId}/contacts/${contactId}`).update({
        tags: newTags,
        updatedAt: new Date().toISOString(),
      });
      return {
        stepId: step.id,
        action: step.action,
        status: 'success',
        message: `Tag "${tag}" ${operation === 'remove' ? 'removed from' : 'added to'} contact`,
      };
    }

    case 'update_lifecycle': {
      const stage = String(step.config.stage || '');
      if (!stage) return { stepId: step.id, action: step.action, status: 'skipped', message: 'No stage specified' };

      await adminDb.doc(`workspaces/${workspaceId}/contacts/${contactId}`).update({
        lifecycleStage: stage,
        updatedAt: new Date().toISOString(),
      });
      return {
        stepId: step.id,
        action: step.action,
        status: 'success',
        message: `Lifecycle updated to "${stage}"`,
      };
    }

    case 'wait': {
      // In a real system this would schedule a delayed continuation.
      // For now we log it as completed since we process synchronously.
      return {
        stepId: step.id,
        action: step.action,
        status: 'success',
        message: `Wait step: ${step.delayMinutes} minutes`,
      };
    }

    case 'webhook': {
      const url = String(step.config.url || '');
      if (!url) return { stepId: step.id, action: step.action, status: 'skipped', message: 'No webhook URL' };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          contactEmail: contact.email,
          contactName: contact.name,
          automationStep: step.id,
          timestamp: new Date().toISOString(),
        }),
      });
      return {
        stepId: step.id,
        action: step.action,
        status: resp.ok ? 'success' : 'failed',
        message: `Webhook ${resp.ok ? 'delivered' : 'failed'}: ${resp.status}`,
      };
    }

    default:
      return {
        stepId: step.id,
        action: step.action,
        status: 'skipped',
        message: `Unknown action: ${step.action}`,
      };
  }
}
