import { afterEach, describe, expect, it } from 'vitest';
import { signUploadToken, verifyUploadToken } from '../public-api/connect-compat';

describe('Connect upload tokens', () => {
  afterEach(() => {
    delete process.env.WORKER_SECRET;
  });

  it('binds a signed token to its workspace, asset, type, and API client', () => {
    process.env.WORKER_SECRET = 'unit-test-upload-signing-secret';
    const token = signUploadToken({
      v: 2,
      ws: 'ws_1',
      assetId: 'ast_1',
      mime: 'image/png',
      clientId: 'client_1',
    });
    expect(verifyUploadToken(token)).toMatchObject({
      v: 2,
      ws: 'ws_1',
      assetId: 'ast_1',
      mime: 'image/png',
      clientId: 'client_1',
    });
    expect(() => verifyUploadToken(`${token.slice(0, -1)}x`)).toThrow('UNAUTHENTICATED');
  });
});
