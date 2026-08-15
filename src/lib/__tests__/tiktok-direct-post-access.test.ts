import { describe, expect, it } from 'vitest';
import { canUseTikTokDirectPost } from '../social/tiktok-direct-post-access';

describe('canUseTikTokDirectPost', () => {
  it('lets an allowlisted tester reach Direct Post', () => {
    expect(canUseTikTokDirectPost('d3vbaba@gmail.com')).toBe(true);
  });

  it('matches the allowlist regardless of casing or stray whitespace', () => {
    expect(canUseTikTokDirectPost('D3vBaba@Gmail.com')).toBe(true);
    expect(canUseTikTokDirectPost('  d3vbaba@gmail.com  ')).toBe(true);
  });

  it('keeps everyone else on the inbox hand-off', () => {
    // Until TikTok's audit passes, an unaudited client's "public" post lands
    // as SELF_ONLY — so the option must not appear for ordinary accounts.
    expect(canUseTikTokDirectPost('someone@example.com')).toBe(false);
    expect(canUseTikTokDirectPost(null)).toBe(false);
    expect(canUseTikTokDirectPost(undefined)).toBe(false);
    expect(canUseTikTokDirectPost('')).toBe(false);
  });

  it('does not treat a lookalike address as the tester', () => {
    expect(canUseTikTokDirectPost('d3vbaba@gmail.com.evil.test')).toBe(false);
    expect(canUseTikTokDirectPost('xd3vbaba@gmail.com')).toBe(false);
  });
});
