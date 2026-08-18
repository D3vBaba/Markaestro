import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionGetMock = vi.fn();
const transactionCreateMock = vi.fn();
const endpointDocMock = vi.fn();
const collectionMock = vi.fn();
const runTransactionMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: collectionMock,
    doc: endpointDocMock,
    runTransaction: runTransactionMock,
  },
}));

vi.mock('@/lib/public-api/keys', () => ({
  buildWebhookSecret: () => ({
    secret: 'whsec_test',
    secretHash: 'hashed-secret',
    secretEncrypted: 'encrypted-secret',
  }),
}));

vi.mock('@/lib/workers/due-workspaces', () => ({
  markWorkspaceDue: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn() },
}));

describe('public API webhook endpoint limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectionMock.mockReturnValue({
      where: () => ({
        limit: () => ({ kind: 'active-endpoints-query' }),
      }),
      doc: () => ({ id: 'wh_1' }),
    });
    runTransactionMock.mockImplementation(async (callback: (tx: {
      get: typeof transactionGetMock;
      create: typeof transactionCreateMock;
    }) => unknown) => callback({ get: transactionGetMock, create: transactionCreateMock }));
  });

  it('rejects new endpoints when the workspace is at the configured cap', async () => {
    transactionGetMock.mockResolvedValue({ size: 25 });
    const { createWebhookEndpoint } = await import('@/lib/public-api/webhooks');

    await expect(createWebhookEndpoint(
      { workspaceId: 'ws_1', principalType: 'api_client', clientId: 'cli_1' },
      { url: 'https://example.com/hook', events: ['post.published'] },
    )).rejects.toThrow('WEBHOOK_ENDPOINT_LIMIT_REACHED');
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it('keeps existing behavior below the cap', async () => {
    transactionGetMock.mockResolvedValue({ size: 24 });
    const { createWebhookEndpoint } = await import('@/lib/public-api/webhooks');

    const result = await createWebhookEndpoint(
      { workspaceId: 'ws_1', principalType: 'api_client', clientId: 'cli_1' },
      { url: 'https://example.com/hook', events: ['post.published'] },
    );

    expect(result).toMatchObject({ id: 'wh_1', status: 'active' });
    expect(result.secret).toBe('whsec_test');
    expect(transactionCreateMock).toHaveBeenCalledOnce();
  });
});
