import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted, so we can't reference top-level variables in the factory.
// Instead, use vi.hoisted to create shared mocks.
const { mockGet, mockLimit, mockStartAfter, mockOrderBy, mockCollection } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockLimit = vi.fn();
  const mockStartAfter = vi.fn();
  const mockOrderBy = vi.fn();
  const mockCollection = vi.fn();
  return { mockGet, mockLimit, mockStartAfter, mockOrderBy, mockCollection };
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}));

import { getAllDocs, getAllMatchingDocs } from '../firestore-pagination';

function buildQueryChain() {
  const chain = {
    orderBy: mockOrderBy,
    limit: mockLimit,
    startAfter: mockStartAfter,
    get: mockGet,
  };
  mockOrderBy.mockReturnValue(chain);
  mockLimit.mockReturnValue(chain);
  mockStartAfter.mockReturnValue(chain);
  mockCollection.mockReturnValue(chain);
  return chain;
}

function makeDocs(count: number, startId = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${startId + i}`,
    data: () => ({ value: startId + i }),
  }));
}

function makeSnap(docs: ReturnType<typeof makeDocs>) {
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  buildQueryChain();
});

describe('getAllDocs', () => {
  it('returns all docs from a single page', async () => {
    const docs = makeDocs(5);
    mockGet.mockResolvedValueOnce(makeSnap(docs));

    const result = await getAllDocs('workspaces');

    expect(mockCollection).toHaveBeenCalledWith('workspaces');
    expect(mockOrderBy).toHaveBeenCalledWith('__name__');
    expect(mockLimit).toHaveBeenCalledWith(200);
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe('doc-0');
  });

  it('paginates across multiple pages', async () => {
    const page1 = makeDocs(200, 0);
    const page2 = makeDocs(50, 200);

    mockGet
      .mockResolvedValueOnce(makeSnap(page1))
      .mockResolvedValueOnce(makeSnap(page2));

    const result = await getAllDocs('workspaces');

    expect(result).toHaveLength(250);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockStartAfter).toHaveBeenCalledWith(page1[199]);
  });

  it('handles empty collections', async () => {
    mockGet.mockResolvedValueOnce(makeSnap([]));

    const result = await getAllDocs('empty-collection');

    expect(result).toHaveLength(0);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('paginates exactly when page is full', async () => {
    const page1 = makeDocs(200);
    mockGet
      .mockResolvedValueOnce(makeSnap(page1))
      .mockResolvedValueOnce(makeSnap([]));

    const result = await getAllDocs('workspaces');

    expect(result).toHaveLength(200);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('handles 3+ pages', async () => {
    const page1 = makeDocs(200, 0);
    const page2 = makeDocs(200, 200);
    const page3 = makeDocs(100, 400);

    mockGet
      .mockResolvedValueOnce(makeSnap(page1))
      .mockResolvedValueOnce(makeSnap(page2))
      .mockResolvedValueOnce(makeSnap(page3));

    const result = await getAllDocs('workspaces');

    expect(result).toHaveLength(500);
    expect(mockGet).toHaveBeenCalledTimes(3);
  });
});

describe('getAllMatchingDocs', () => {
  it('paginates a base query', async () => {
    const page1 = makeDocs(200, 0);
    const page2 = makeDocs(30, 200);

    const fakeQuery = {
      limit: mockLimit,
      startAfter: mockStartAfter,
      get: mockGet,
    } as unknown as FirebaseFirestore.Query;

    mockLimit.mockReturnValue(fakeQuery);
    mockStartAfter.mockReturnValue(fakeQuery);

    mockGet
      .mockResolvedValueOnce(makeSnap(page1))
      .mockResolvedValueOnce(makeSnap(page2));

    const result = await getAllMatchingDocs(fakeQuery);

    expect(result).toHaveLength(230);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('respects custom pageSize', async () => {
    // 5 docs with pageSize=10 → single page, stops because size < pageSize
    const page1 = makeDocs(5, 0);

    const fakeQuery = {
      limit: mockLimit,
      startAfter: mockStartAfter,
      get: mockGet,
    } as unknown as FirebaseFirestore.Query;

    mockLimit.mockReturnValue(fakeQuery);
    mockStartAfter.mockReturnValue(fakeQuery);
    mockGet.mockResolvedValueOnce(makeSnap(page1));

    await getAllMatchingDocs(fakeQuery, 10);

    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it('handles empty result', async () => {
    const fakeQuery = {
      limit: mockLimit,
      startAfter: mockStartAfter,
      get: mockGet,
    } as unknown as FirebaseFirestore.Query;

    mockLimit.mockReturnValue(fakeQuery);

    mockGet.mockResolvedValueOnce(makeSnap([]));

    const result = await getAllMatchingDocs(fakeQuery);
    expect(result).toHaveLength(0);
  });
});
