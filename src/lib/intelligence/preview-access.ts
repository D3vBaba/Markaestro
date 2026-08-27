import type { RequestContext } from '@/lib/server-auth';

/** Private preview — Intelligence is hidden from all other accounts. */
export const INTELLIGENCE_PREVIEW_EMAIL = 'd3vbaba@gmail.com';
export const INTELLIGENCE_PREVIEW_UID = 'KTKvHOYFlrRyHw14oGi3jnqIr6m2';

export function canAccessIntelligencePreview(input: {
  email?: string | null;
  uid?: string | null;
}): boolean {
  const email = input.email?.trim().toLowerCase();
  if (email === INTELLIGENCE_PREVIEW_EMAIL) return true;
  if (input.uid === INTELLIGENCE_PREVIEW_UID) return true;
  return false;
}

export function requireIntelligencePreviewUser(ctx: Pick<RequestContext, 'email' | 'uid'>): void {
  if (!canAccessIntelligencePreview(ctx)) throw new Error('FEATURE_NOT_AVAILABLE');
}
