import { generateStructured } from './ai-gateway';
import { adminDb } from '@/lib/firebase-admin';
import { z } from 'zod';
import {
  groupedPerformance,
  platformComparisons,
  strategistPostRows,
  timingPerformance,
  topPostsByViews,
} from './strategist-evidence';

export const strategistTools = [
  'audience_performance', 'audience_alignment', 'top_posts', 'pillar_performance',
  'hook_performance', 'timing_performance', 'drift', 'learnings', 'campaigns',
  'platform_comparisons', 'experiments',
] as const;
export type StrategistTool = (typeof strategistTools)[number];

const selectionSchema = z.object({
  tool: z.enum(strategistTools),
  reason: z.string().max(300),
});
const answerSchema = z.object({
  answer: z.string().min(1).max(4000),
  evidenceIds: z.array(z.string().max(160)).max(20),
  limitations: z.array(z.string().max(400)).max(10),
});

async function collectionEvidence(workspaceId: string, collection: string, productId: string, limit = 50) {
  const snapshot = await adminDb.collection(`workspaces/${workspaceId}/${collection}`)
    .where('productId', '==', productId).limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function executeStrategistTool(
  workspaceId: string,
  productId: string,
  tool: StrategistTool,
  timeZone = 'UTC',
): Promise<unknown[]> {
  if (tool === 'learnings') return collectionEvidence(workspaceId, 'brandLearnings', productId);
  if (tool === 'campaigns') return collectionEvidence(workspaceId, 'campaigns', productId);
  if (tool === 'experiments') return collectionEvidence(workspaceId, 'experiments', productId);
  if (tool === 'drift') return collectionEvidence(workspaceId, 'audienceDriftEvents', productId);
  if (tool === 'audience_performance' || tool === 'audience_alignment') {
    return collectionEvidence(workspaceId, 'audienceSnapshots', productId);
  }

  const posts = await collectionEvidence(workspaceId, 'socialPosts', productId, 250);
  const rows = strategistPostRows(posts as Array<Record<string, unknown> & { id: unknown }>);
  if (tool === 'top_posts') return topPostsByViews(rows);
  if (tool === 'platform_comparisons') return platformComparisons(rows);
  if (tool === 'pillar_performance') return groupedPerformance(rows, (row) => row.pillar);
  if (tool === 'hook_performance') return groupedPerformance(rows, (row) => row.hook);
  if (tool === 'timing_performance') return timingPerformance(rows, timeZone);
  return rows.slice(0, 100);
}

export async function askStrategist(input: {
  workspaceId: string;
  productId: string;
  question: string;
  timeZone?: string;
}): Promise<{ answer: string; tool: StrategistTool; evidenceIds: string[]; limitations: string[]; model: string }> {
  const selection = await generateStructured({
    schema: selectionSchema,
    system: `Select exactly one approved analytical tool: ${strategistTools.join(', ')}. Do not answer the question yet.`,
    untrustedContent: input.question,
  });
  const evidence = await executeStrategistTool(
    input.workspaceId,
    input.productId,
    selection.value.tool,
    input.timeZone,
  );

  // Empty evidence is common for new brands — skip a second model call and
  // return an actionable response so the UI never looks like it failed.
  if (evidence.length === 0) {
    return {
      answer: emptyEvidenceAnswer(selection.value.tool),
      tool: selection.value.tool,
      evidenceIds: [],
      limitations: [
        'No matching measured records were available for this question yet.',
        'Publish or sync posts, then ask again once Intelligence has data to cite.',
      ],
      model: 'none',
    };
  }

  const explanation = await generateStructured({
    schema: answerSchema,
    modelClass: 'strategist',
    system: 'Explain only the supplied analytical evidence. Use associations, never causal claims. Cite evidence ids, state missing coverage or sample limitations, and never invent metrics.',
    untrustedContent: JSON.stringify({ question: input.question, tool: selection.value.tool, evidence }),
  });
  const validIds = new Set(evidence.map((row) => String((row as { id?: unknown }).id || '')));
  return {
    answer: explanation.value.answer,
    tool: selection.value.tool,
    evidenceIds: explanation.value.evidenceIds.filter((id) => validIds.has(id)),
    limitations: explanation.value.limitations,
    model: explanation.model,
  };
}

function emptyEvidenceAnswer(tool: StrategistTool): string {
  switch (tool) {
    case 'experiments':
      return [
        'There are no experiments for this brand yet, so there is nothing measured to compare.',
        'Create an experiment in this tab with a clear hypothesis and two arms (A/B).',
        'Publish or assign posts to each arm until each has at least five measured observations, then ask again for a winner.',
      ].join(' ');
    case 'learnings':
      return 'No statistical playbook learnings are stored for this brand yet. Keep publishing measured posts; patterns appear once groups reach a usable sample size.';
    case 'campaigns':
      return 'No campaigns are set up for this brand yet. Name a campaign in Intelligence, assign posts as you publish, then ask again to compare campaign performance.';
    case 'drift':
      return 'No audience-drift events are recorded for this brand yet. Drift appears after audience snapshots show a sustained mix shift.';
    case 'audience_performance':
    case 'audience_alignment':
      return 'No audience snapshots are available for this brand yet. Connect channels and sync metrics, then ask again about audience fit or alignment.';
    case 'timing_performance':
      return 'Not enough dated posts with metrics to recommend posting windows yet. Timing needs a larger sample of measured posts.';
    case 'top_posts':
    case 'platform_comparisons':
    case 'pillar_performance':
    case 'hook_performance':
      return 'No measured posts are available for this brand yet. Publish or import posts with metrics, then ask again about top content, platforms, or formats.';
    default:
      return 'Intelligence does not have matching measured evidence for that question yet. Publish or sync more posts, then try again.';
  }
}
