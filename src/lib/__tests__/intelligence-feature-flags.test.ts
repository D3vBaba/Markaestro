import { beforeEach, describe, expect, it, vi } from 'vitest';

const rollout = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: () => ({
      get: async () => ({
        exists: Object.keys(rollout.value).length > 0,
        data: () => rollout.value,
      }),
    }),
  },
}));

import {
  clearIntelligenceRolloutCache,
  isIntelligencePhaseEnabled,
} from '@/lib/intelligence/feature-flags';

describe('intelligence feature flags', () => {
  beforeEach(() => {
    rollout.value = {};
    clearIntelligenceRolloutCache();
    delete process.env.SOCIAL_INTELLIGENCE_DEFAULT_STAGE;
    delete process.env.SOCIAL_INTELLIGENCE_FOUNDATION_STAGE;
  });

  it('fails closed when the global stage is off', async () => {
    process.env.SOCIAL_INTELLIGENCE_DEFAULT_STAGE = 'off';
    await expect(isIntelligencePhaseEnabled({
      phase: 'foundation',
      workspaceId: 'ws_1',
      uid: 'user_1',
      entitled: true,
    })).resolves.toBe(false);
  });

  it('allows only listed workspaces in allowlist stage', async () => {
    rollout.value = {
      phases: {
        foundation: { stage: 'allowlist', workspaceAllowlist: ['ws_ok'] },
      },
    };
    await expect(isIntelligencePhaseEnabled({
      phase: 'foundation',
      workspaceId: 'ws_ok',
      uid: 'user_1',
      entitled: false,
    })).resolves.toBe(true);
    clearIntelligenceRolloutCache();
    await expect(isIntelligencePhaseEnabled({
      phase: 'foundation',
      workspaceId: 'ws_other',
      uid: 'user_1',
      entitled: true,
    })).resolves.toBe(false);
  });

  it('honors the kill switch immediately', async () => {
    rollout.value = { killSwitch: true, phases: { foundation: { stage: 'entitled_ga' } } };
    await expect(isIntelligencePhaseEnabled({
      phase: 'foundation',
      workspaceId: 'ws_1',
      uid: 'user_1',
      entitled: true,
    })).resolves.toBe(false);
  });
});
