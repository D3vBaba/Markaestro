import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireContextMock = vi.fn();
const requirePermissionMock = vi.fn();
const getConnectionMock = vi.fn();
const deleteConnectionMock = vi.fn();
const listProviderConnectionsMock = vi.fn();
const revokeAccessTokenMock = vi.fn();
const decryptMock = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  requireContext: requireContextMock,
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock('@/lib/platform/connections', () => ({
  getConnection: getConnectionMock,
  deleteConnection: deleteConnectionMock,
  listProviderConnections: listProviderConnectionsMock,
}));

vi.mock('@/lib/oauth/flow', () => ({
  revokeAccessToken: revokeAccessTokenMock,
}));

vi.mock('@/lib/crypto', () => ({
  decrypt: decryptMock,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(),
  },
}));

const context = {
  uid: 'user_1',
  workspaceId: 'workspace_1',
  role: 'admin',
};

function disconnectRequest(provider: string, productId?: string) {
  return new Request(`http://localhost/api/oauth/disconnect/${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(productId ? { productId } : {}),
  });
}

describe('POST /api/oauth/disconnect/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireContextMock.mockResolvedValue(context);
    listProviderConnectionsMock.mockResolvedValue([]);
  });

  it('removes only the local Meta Page selection for a product', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      disconnectRequest('meta', 'product_1'),
      { params: Promise.resolve({ provider: 'meta' }) },
    );

    expect(response.status).toBe(200);
    expect(deleteConnectionMock).toHaveBeenCalledWith(
      'workspace_1',
      'meta',
      'product_1',
    );
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(decryptMock).not.toHaveBeenCalled();
    expect(revokeAccessTokenMock).not.toHaveBeenCalled();
  });

  it('still revokes independent product credentials for non-Meta providers', async () => {
    getConnectionMock.mockResolvedValue({
      accessTokenEncrypted: 'encrypted-token',
    });
    decryptMock.mockReturnValue('plain-token');

    const { POST } = await import('./route');
    const response = await POST(
      disconnectRequest('threads', 'product_1'),
      { params: Promise.resolve({ provider: 'threads' }) },
    );

    expect(response.status).toBe(200);
    expect(revokeAccessTokenMock).toHaveBeenCalledWith('threads', 'plain-token');
    expect(deleteConnectionMock).toHaveBeenCalledWith(
      'workspace_1',
      'threads',
      'product_1',
    );
  });
});
