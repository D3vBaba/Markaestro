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

describe('PUT /api/products/[id]/brand-voice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireContextMock.mockResolvedValue(ctx);
    requirePermissionMock.mockReturnValue(undefined);
    const data = {
      brandVoice: null,
      brandIdentity: { logoUrl: '', primaryColor: '', secondaryColor: '', accentColor: '' },
    };
    getMock.mockResolvedValue({
      exists: true,
      data: () => data,
    });
    updateMock.mockImplementation(async (patch: Record<string, unknown>) => {
      Object.assign(data, patch);
    });
  });

  async function put(body: unknown) {
    const { PUT } = await import('./route');
    return PUT(
      new Request('http://localhost/api/products/prod_1/brand-voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'prod_1' }) },
    );
  }

  it('saves 3-digit and hashless hex colors', async () => {
    const response = await put({
      brandIdentity: {
        logoUrl: '',
        primaryColor: '#fff',
        secondaryColor: '2563eb',
        accentColor: '',
      },
    });
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        brandIdentity: {
          logoUrl: '',
          primaryColor: '#FFFFFF',
          secondaryColor: '#2563EB',
          accentColor: '',
        },
        updatedBy: 'user_1',
      }),
    );
  });
});
