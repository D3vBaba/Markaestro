import { describe, expect, it } from 'vitest';
import { getSafeNextPath } from './safe-next';

describe('getSafeNextPath', () => {
  it('returns the fallback for empty or null input', () => {
    expect(getSafeNextPath(null)).toBe('/settings');
    expect(getSafeNextPath(undefined)).toBe('/settings');
    expect(getSafeNextPath('')).toBe('/settings');
  });

  it('passes through safe in-app paths', () => {
    expect(getSafeNextPath('/dashboard')).toBe('/dashboard');
    expect(getSafeNextPath('/settings')).toBe('/settings');
    expect(getSafeNextPath('/content/abc')).toBe('/content/abc');
  });

  it('preserves query string and fragment on safe paths', () => {
    expect(getSafeNextPath('/dashboard?tab=1')).toBe('/dashboard?tab=1');
    expect(getSafeNextPath('/dashboard#section')).toBe('/dashboard#section');
    expect(getSafeNextPath('/dashboard?tab=1#x')).toBe('/dashboard?tab=1#x');
  });

  it('rejects protocol-relative URLs', () => {
    expect(getSafeNextPath('//evil.com')).toBe('/settings');
    expect(getSafeNextPath('//evil.com/dashboard')).toBe('/settings');
    expect(getSafeNextPath('///evil.com')).toBe('/settings');
  });

  it('rejects backslash-prefix tricks', () => {
    expect(getSafeNextPath('/\\evil.com')).toBe('/settings');
    expect(getSafeNextPath('/\\\\evil.com')).toBe('/settings');
  });

  it('rejects absolute URLs with a scheme', () => {
    expect(getSafeNextPath('https://evil.com')).toBe('/settings');
    expect(getSafeNextPath('http://evil.com/path')).toBe('/settings');
    expect(getSafeNextPath('javascript:alert(1)')).toBe('/settings');
    expect(getSafeNextPath('data:text/html,<script>alert(1)</script>')).toBe('/settings');
  });

  it('rejects paths with control characters or whitespace', () => {
    expect(getSafeNextPath('/dashboard\n/evil')).toBe('/settings');
    expect(getSafeNextPath('/dashboard\r\nHost: evil.com')).toBe('/settings');
    expect(getSafeNextPath('/dashboard%20 ')).toBe('/settings');
    expect(getSafeNextPath(' /dashboard')).toBe('/settings');
  });

  it('rejects paths that do not start with /', () => {
    expect(getSafeNextPath('dashboard')).toBe('/settings');
    expect(getSafeNextPath('../etc/passwd')).toBe('/settings');
  });

  it('blocks self-loops back to /oauth/complete', () => {
    expect(getSafeNextPath('/oauth/complete')).toBe('/settings');
    expect(getSafeNextPath('/oauth/complete?x=1')).toBe('/settings');
  });

  it('rejects excessively long paths', () => {
    expect(getSafeNextPath('/' + 'a'.repeat(3000))).toBe('/settings');
  });
});
