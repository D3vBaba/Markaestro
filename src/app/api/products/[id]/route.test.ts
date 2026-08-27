import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireContextMock = vi.fn();
const requirePermissionMock = vi.fn();
const getMock = vi.fn();
const updateMock = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  requireContext: requireContextMock,
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: () => ({
      get: getMock,
      update: updateMock,
    }),
  },
}));

const ctx = {
  uid: 'user_1',
  email: 'owner@example.com',
  workspaceId: 'ws_1',
  role: 'owner' as const,
  emailVerified: true,
};

describe('PUT /api/products/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireContextMock.mockResolvedValue(ctx);
    requirePermissionMock.mockReturnValue(undefined);
    getMock.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Acme', url: '', categories: ['saas'], status: 'active' }),
    });
    updateMock.mockResolvedValue(undefined);
  });

  async function put(body: unknown) {
    const { PUT } = await import('./route');
    return PUT(
      new Request('http://localhost/api/products/prod_1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'prod_1' }) },
    );
  }

  it('saves a website typed without https://', async () => {
    const response = await put({
      name: 'Acme',
      description: 'Widgets',
      url: 'acme.com',
      categories: ['saas'],
      status: 'active',
    });
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://acme.com',
        name: 'Acme',
        updatedBy: 'user_1',
      }),
    );
  });

  it('still rejects a website that is not a hostname', async () => {
    const response = await put({
      name: 'Acme',
      url: 'not a website',
      categories: ['saas'],
      status: 'active',
    });
    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: 'VALIDATION_ERROR' });
  });
});
