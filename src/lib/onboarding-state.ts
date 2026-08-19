/**
 * The onboarding funnel's resume state.
 *
 * `/onboarding` is deliberately public — the quiz is the top of the
 * acquisition funnel and runs before an account exists. The snapshot below is
 * what lets a visitor reload, come back from an OAuth hop, or finish the quiz
 * in a second sitting without starting over. It lives in sessionStorage, so it
 * is scoped to the tab and dies with it.
 *
 * Because it survives a sign-out within the same tab, both the step gate and
 * the logout path here matter: without them a signed-out visitor resumes onto
 * the previous account's paywall, brand name, and colors.
 */

export const ONBOARDING_STATE_KEY = 'onboarding_state_v4';

/**
 * Drop the resume snapshot. Called on logout: whatever the funnel collected
 * belongs to the account that just left, and the next visitor in this tab
 * must start clean rather than inherit it.
 */
export function clearOnboardingState(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(ONBOARDING_STATE_KEY);
  } catch {
    // Private-mode / disabled storage: nothing to clear.
  }
}

/**
 * The step a visitor is actually allowed to be on.
 *
 * Everything after the register step describes a real account — a brand to
 * save, channels to connect, a plan to charge — so a signed-out visitor is
 * pulled back to register no matter what the restored snapshot claims.
 * Returns the step untouched while auth is still resolving, so a signed-in
 * user is never bounced backwards on first paint.
 */
export function allowedOnboardingStep(opts: {
  step: number;
  registerStep: number;
  signedIn: boolean;
  authLoading: boolean;
}): number {
  const { step, registerStep, signedIn, authLoading } = opts;
  if (authLoading || signedIn) return step;
  return Math.min(step, registerStep);
}
