import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationGroupsForUser } from '@/lib/nav';

/**
 * The preview allowlist was a hardcoded email and uid in a source constant:
 * a production access-control decision that needed a deploy to change.
 *
 * It is now configuration first (a Firestore feature-flag document, then
 * environment variables) with the constants kept as a fallback, so a Firestore
 * outage cannot lock the preview user out of their own preview.
 */

const docGetMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { doc: (path: string) => ({ get: () => docGetMock(path) }) },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

async function load() {
  const mod = {
    ...(await import('@/lib/intelligence/preview-access')),
    ...(await import('@/lib/intelligence/preview-access-server')),
  };
  mod.resetIntelligencePreviewCache();
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
  docGetMock.mockResolvedValue({ exists: false, data: () => undefined });
  delete process.env.INTELLIGENCE_PREVIEW_EMAILS;
  delete process.env.INTELLIGENCE_PREVIEW_UIDS;
});

afterEach(async () => {
  (await import('@/lib/intelligence/preview-access-server')).resetIntelligencePreviewCache();
});

describe('intelligence preview access', () => {
  it('allows the built-in preview account by email or uid', async () => {
    const m = await load();
    expect(await m.canAccessIntelligencePreviewAsync({ email: m.INTELLIGENCE_PREVIEW_EMAIL })).toBe(true);
    expect(await m.canAccessIntelligencePreviewAsync({ uid: m.INTELLIGENCE_PREVIEW_UID })).toBe(true);
    expect(await m.canAccessIntelligencePreviewAsync({ email: 'other@example.com', uid: 'other_uid' }))
      .toBe(false);
  });

  it('adds users from the Firestore feature flag without a deploy', async () => {
    docGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['New.User@Example.com'], uids: ['uid_new'] }),
    });
    const m = await load();

    expect(await m.canAccessIntelligencePreviewAsync({ email: 'new.user@example.com' })).toBe(true);
    expect(await m.canAccessIntelligencePreviewAsync({ uid: 'uid_new' })).toBe(true);
    expect(docGetMock).toHaveBeenCalledWith('_featureFlags/intelligencePreview');
  });

  it('adds users from environment variables, for staging and local work', async () => {
    process.env.INTELLIGENCE_PREVIEW_EMAILS = 'a@example.com, b@example.com';
    process.env.INTELLIGENCE_PREVIEW_UIDS = 'uid_a';
    const m = await load();

    expect(await m.canAccessIntelligencePreviewAsync({ email: 'b@example.com' })).toBe(true);
    expect(await m.canAccessIntelligencePreviewAsync({ uid: 'uid_a' })).toBe(true);
  });

  it('falls back to the built-in list when the flag read fails', async () => {
    // A gate that fails closed on its own configuration read turns a Firestore
    // blip into a total outage of the feature.
    docGetMock.mockRejectedValue(new Error('firestore unavailable'));
    const m = await load();

    expect(await m.canAccessIntelligencePreviewAsync({ email: m.INTELLIGENCE_PREVIEW_EMAIL })).toBe(true);
    expect(await m.canAccessIntelligencePreviewAsync({ email: 'other@example.com' })).toBe(false);
  });

  it('caches the allowlist so a gated request is not a Firestore read', async () => {
    const m = await load();
    await m.canAccessIntelligencePreviewAsync({ email: 'a@example.com' });
    await m.canAccessIntelligencePreviewAsync({ email: 'b@example.com' });
    expect(docGetMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-preview user through the throwing gate', async () => {
    const m = await load();
    await expect(m.requireIntelligencePreviewUser({ email: 'other@example.com', uid: 'other' }))
      .rejects.toThrow('FEATURE_NOT_AVAILABLE');
    await expect(m.requireIntelligencePreviewUser({ email: m.INTELLIGENCE_PREVIEW_EMAIL, uid: 'x' }))
      .resolves.toBeUndefined();
  });

  it('hides intelligence nav for other users', async () => {
    const m = await load();
    const previewNav = navigationGroupsForUser(m.INTELLIGENCE_PREVIEW_EMAIL, m.INTELLIGENCE_PREVIEW_UID);
    const otherNav = navigationGroupsForUser('other@example.com', 'other_uid');
    expect(previewNav.flatMap((group) => group.items).some((item) => item.href === '/intelligence')).toBe(true);
    expect(otherNav.flatMap((group) => group.items).some((item) => item.href === '/intelligence')).toBe(false);
  });
});
