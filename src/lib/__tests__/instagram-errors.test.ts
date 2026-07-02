import { describe, expect, it } from 'vitest';
import {
  isInstagramGraphRefusal,
  isInstagramGraphUnsupported,
  isInstagramMethodTypeUnsupported,
} from '../oauth/instagram-errors';

const methodTypePost = { error: { code: 100, message: 'Unsupported request - method type: post' } };
const methodTypeGet = { error: { code: 100, message: 'Unsupported request - method type: get' } };
const classicUnsupported = { error: { code: 100, message: 'Unsupported request' } };
const expiredToken = { error: { code: 190, message: 'Error validating access token: Session has expired' } };

describe('isInstagramMethodTypeUnsupported', () => {
  it('matches the method-type variant, optionally by verb', () => {
    expect(isInstagramMethodTypeUnsupported(methodTypePost)).toBe(true);
    expect(isInstagramMethodTypeUnsupported(methodTypePost, 'post')).toBe(true);
    expect(isInstagramMethodTypeUnsupported(methodTypePost, 'get')).toBe(false);
    expect(isInstagramMethodTypeUnsupported(classicUnsupported)).toBe(false);
  });
});

describe('isInstagramGraphUnsupported', () => {
  it('matches classic code-100 but excludes the method-type variant', () => {
    expect(isInstagramGraphUnsupported(classicUnsupported)).toBe(true);
    expect(isInstagramGraphUnsupported(methodTypeGet)).toBe(false);
    expect(isInstagramGraphUnsupported(expiredToken)).toBe(false);
  });
});

describe('isInstagramGraphRefusal', () => {
  it('treats both code-100 variants as the same hard refusal', () => {
    expect(isInstagramGraphRefusal(classicUnsupported)).toBe(true);
    expect(isInstagramGraphRefusal(methodTypePost)).toBe(true);
    expect(isInstagramGraphRefusal(methodTypeGet)).toBe(true);
  });

  it('does not classify token expiry or empty payloads as refusal', () => {
    expect(isInstagramGraphRefusal(expiredToken)).toBe(false);
    expect(isInstagramGraphRefusal({})).toBe(false);
  });
});
