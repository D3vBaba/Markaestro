import { describe, expect, it } from 'vitest';
import { allowedOnboardingStep } from '../onboarding-state';

// Mirrors the page's indices: 5 quiz questions, then register at 5.
const REGISTER_STEP = 5;
const PRODUCT_STEP = 6;
const PAYWALL_STEP = 9;

function gate(step: number, signedIn: boolean, authLoading = false) {
  return allowedOnboardingStep({ step, registerStep: REGISTER_STEP, signedIn, authLoading });
}

describe('allowedOnboardingStep', () => {
  it('pulls a signed-out visitor off the paywall back to register', () => {
    expect(gate(PAYWALL_STEP, false)).toBe(REGISTER_STEP);
  });

  it('pulls a signed-out visitor off every post-register step', () => {
    for (const step of [PRODUCT_STEP, PRODUCT_STEP + 1, PRODUCT_STEP + 2, PAYWALL_STEP]) {
      expect(gate(step, false)).toBe(REGISTER_STEP);
    }
  });

  it('leaves the public quiz alone', () => {
    for (const step of [0, 1, 2, 3, 4, REGISTER_STEP]) {
      expect(gate(step, false)).toBe(step);
    }
  });

  it('leaves a signed-in user where they are', () => {
    expect(gate(PAYWALL_STEP, true)).toBe(PAYWALL_STEP);
    expect(gate(PRODUCT_STEP, true)).toBe(PRODUCT_STEP);
  });

  it('does not bounce anyone while auth is still resolving', () => {
    expect(gate(PAYWALL_STEP, false, true)).toBe(PAYWALL_STEP);
  });
});
