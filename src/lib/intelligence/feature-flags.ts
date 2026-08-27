import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';

export const intelligencePhases = ['foundation', 'learning', 'growth', 'advanced'] as const;
export type IntelligencePhase = (typeof intelligencePhases)[number];
export type RolloutStage = 'off' | 'shadow' | 'allowlist' | 'percentage' | 'entitled_ga';

type RolloutPhaseConfig = {
  stage?: RolloutStage;
  percentage?: number;
  workspaceAllowlist?: string[];
  userAllowlist?: string[];
  killSwitch?: boolean;
};

type RolloutDocument = {
  killSwitch?: boolean;
  phases?: Partial<Record<IntelligencePhase, RolloutPhaseConfig>>;
};

const CACHE_TTL_MS = 30_000;
let cached: { expiresAt: number; value: RolloutDocument } | null = null;

function envStage(phase: IntelligencePhase): RolloutStage {
  const specific = process.env[`SOCIAL_INTELLIGENCE_${phase.toUpperCase()}_STAGE`];
  const fallback = process.env.SOCIAL_INTELLIGENCE_DEFAULT_STAGE;
  const value = specific || fallback || 'off';
  return ['off', 'shadow', 'allowlist', 'percentage', 'entitled_ga'].includes(value)
    ? value as RolloutStage
    : 'off';
}

async function rolloutDocument(): Promise<RolloutDocument> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const snapshot = await adminDb.doc('_rollouts/socialIntelligence').get();
    const value = snapshot.exists ? snapshot.data() as RolloutDocument : {};
    cached = { expiresAt: Date.now() + CACHE_TTL_MS, value };
    return value;
  } catch {
    // Feature infrastructure must fail closed.
    return {};
  }
}

export function rolloutBucket(workspaceId: string, phase: IntelligencePhase): number {
  const digest = createHash('sha256').update(`${phase}:${workspaceId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export async function isIntelligencePhaseEnabled(input: {
  phase: IntelligencePhase;
  workspaceId: string;
  uid: string;
  entitled: boolean;
  includeShadow?: boolean;
}): Promise<boolean> {
  const document = await rolloutDocument();
  const config = document.phases?.[input.phase] ?? {};
  if (document.killSwitch || config.killSwitch) return false;
  const stage = config.stage ?? envStage(input.phase);
  if (stage === 'off') return false;
  if (stage === 'shadow') return input.includeShadow === true;
  if (stage === 'allowlist') {
    return Boolean(
      config.workspaceAllowlist?.includes(input.workspaceId)
      || config.userAllowlist?.includes(input.uid),
    );
  }
  if (stage === 'percentage') {
    const percentage = Math.min(100, Math.max(0, config.percentage ?? 0));
    return input.entitled && rolloutBucket(input.workspaceId, input.phase) < percentage;
  }
  return input.entitled;
}

export async function requireIntelligencePhase(input: {
  phase: IntelligencePhase;
  workspaceId: string;
  uid: string;
  entitled: boolean;
}): Promise<void> {
  if (!await isIntelligencePhaseEnabled(input)) throw new Error('FEATURE_NOT_AVAILABLE');
}

/** Test/operations hook; never exposed to clients. */
export function clearIntelligenceRolloutCache(): void {
  cached = null;
}

