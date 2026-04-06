import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDownloadUrl } from '../storage';

// uploadToStorage requires firebase-admin, so we test it with mocks.
// buildDownloadUrl is a pure function and can be tested directly.

describe('buildDownloadUrl', () => {
  it('returns a firebasestorage.googleapis.com URL with token', () => {
    const url = buildDownloadUrl('my-bucket', 'path/to/file.png', 'abc-token');
    expect(url).toBe(
      'https://firebasestorage.googleapis.com/v0/b/my-bucket/o/path%2Fto%2Ffile.png?alt=media&token=abc-token',
    );
  });

  it('URL-encodes the file path', () => {
    const url = buildDownloadUrl('bucket', 'workspaces/ws1/generated/file name.jpg', 'tok');
    expect(url).toContain('workspaces%2Fws1%2Fgenerated%2Ffile%20name.jpg');
    expect(url).toContain('token=tok');
  });

  it('handles special characters in path', () => {
    const url = buildDownloadUrl('bucket', 'path/with+plus&amp.png', 'token123');
    expect(url).toContain(encodeURIComponent('path/with+plus&amp.png'));
  });
});

describe('uploadToStorage', () => {
  const mockSave = vi.fn().mockResolvedValue(undefined);
  const mockFile = vi.fn().mockReturnValue({ save: mockSave });
  const mockBucket = vi.fn().mockReturnValue({ name: 'test-bucket', file: mockFile });

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockSave.mockResolvedValue(undefined);
    mockFile.mockReturnValue({ save: mockSave });
    mockBucket.mockReturnValue({ name: 'test-bucket', file: mockFile });
  });

  it('calls file.save with correct metadata and returns a token-gated URL', async () => {
    // Mock firebase-admin
    vi.doMock('firebase-admin', () => ({
      storage: () => ({ bucket: () => ({ name: 'test-bucket', file: mockFile }) }),
    }));

    const { uploadToStorage } = await import('../storage');
    const buffer = Buffer.from('test-image-data');
    const url = await uploadToStorage('path/to/image.png', buffer, 'image/png', {
      workspaceId: 'ws1',
    });

    // Verify file.save was called
    expect(mockFile).toHaveBeenCalledWith('path/to/image.png');
    expect(mockSave).toHaveBeenCalledOnce();

    // Verify metadata
    const saveArgs = mockSave.mock.calls[0];
    expect(saveArgs[0]).toBe(buffer);
    const metadata = saveArgs[1].metadata;
    expect(metadata.contentType).toBe('image/png');
    expect(metadata.metadata.workspaceId).toBe('ws1');
    expect(metadata.metadata.firebaseStorageDownloadTokens).toBeDefined();

    // Verify URL format
    expect(url).toContain('firebasestorage.googleapis.com');
    expect(url).toContain('test-bucket');
    expect(url).toContain(encodeURIComponent('path/to/image.png'));
    expect(url).toContain('token=');
    // Token in URL matches the one in metadata
    expect(url).toContain(metadata.metadata.firebaseStorageDownloadTokens);
  });

  it('does NOT call makePublic', async () => {
    const mockMakePublic = vi.fn();
    const fileObj = { save: mockSave, makePublic: mockMakePublic };
    vi.doMock('firebase-admin', () => ({
      storage: () => ({ bucket: () => ({ name: 'test-bucket', file: () => fileObj }) }),
    }));

    const { uploadToStorage } = await import('../storage');
    await uploadToStorage('file.png', Buffer.from('x'), 'image/png');

    expect(mockMakePublic).not.toHaveBeenCalled();
  });
});
