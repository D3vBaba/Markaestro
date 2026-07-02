import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection, PublishRequest } from '../platform/types';

const fetchWithRetryMock = vi.fn();
const getAccessTokenMock = vi.fn();

vi.mock('@/lib/fetch-retry', () => ({
  fetchWithRetry: fetchWithRetryMock,
}));

vi.mock('@/lib/platform/base-adapter', () => ({
  getAccessToken: getAccessTokenMock,
}));

const baseProfileConnection: PlatformConnection = {
  provider: 'linkedin_profile',
  channels: ['linkedin'],
  capabilities: [],
  status: 'connected',
  accessTokenEncrypted: 'encrypted',
  metadata: {
    linkedinProfileId: 'person_123',
    linkedinProfileUrn: 'urn:li:person:person_123',
    linkedinProfileName: 'Pat Publisher',
    linkedinDestinationUrn: 'urn:li:person:person_123',
    linkedinDestinationType: 'profile',
    linkedinDestinationName: 'Pat Publisher',
    linkedinDestinationAccountId: 'person_123',
    linkedinScopes: ['w_member_social'],
    linkedinPages: [],
  },
  workspaceId: 'ws_123',
  productId: 'prod_123',
  updatedBy: 'user_123',
  updatedAt: '2026-06-21T00:00:00.000Z',
  createdAt: '2026-06-21T00:00:00.000Z',
};

const baseCommunityConnection: PlatformConnection = {
  provider: 'linkedin_community',
  channels: ['linkedin'],
  capabilities: [],
  status: 'connected',
  accessTokenEncrypted: 'encrypted',
  metadata: {
    linkedinDestinationUrn: 'urn:li:organization:2414183',
    linkedinDestinationType: 'page',
    linkedinDestinationName: 'Acme LinkedIn',
    linkedinDestinationAccountId: '2414183',
    linkedinScopes: ['w_organization_social'],
    linkedinPages: [
      {
        id: '2414183',
        urn: 'urn:li:organization:2414183',
        type: 'page',
        name: 'Acme LinkedIn',
        role: 'ADMINISTRATOR',
      },
    ],
  },
  workspaceId: 'ws_123',
  productId: 'prod_123',
  updatedBy: 'user_123',
  updatedAt: '2026-06-21T00:00:00.000Z',
  createdAt: '2026-06-21T00:00:00.000Z',
};

const request: PublishRequest = {
  content: 'Launch update',
  channel: 'linkedin',
  mediaUrls: [],
};

describe('linkedinPublishingAdapter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getAccessTokenMock.mockReturnValue('access_token_123');
  });

  it('creates a text post against the selected profile destination', async () => {
    fetchWithRetryMock.mockResolvedValueOnce(new Response(JSON.stringify({}), {
      status: 201,
      headers: { 'x-restli-id': 'urn:li:ugcPost:123' },
    }));

    const { linkedinPublishingAdapter } = await import('../platform/adapters/linkedin-publishing');
    const result = await linkedinPublishingAdapter.publish(baseProfileConnection, request);

    expect(result).toEqual({
      success: true,
      externalId: 'urn:li:ugcPost:123',
      externalUrl: 'https://www.linkedin.com/feed/update/urn:li:ugcPost:123/',
    });
    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      'https://api.linkedin.com/rest/posts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access_token_123',
          'Linkedin-Version': '202606',
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        }),
        body: expect.any(String),
      }),
      expect.objectContaining({ maxRetries: 2 }),
    );
    const body = JSON.parse(fetchWithRetryMock.mock.calls[0][1].body);
    expect(body).toEqual(expect.objectContaining({
      author: 'urn:li:person:person_123',
      commentary: 'Launch update',
      lifecycleState: 'PUBLISHED',
    }));
  });

  it('uses a requested LinkedIn Page destination when destinationId is provided', async () => {
    fetchWithRetryMock.mockResolvedValueOnce(new Response(JSON.stringify({}), {
      status: 201,
      headers: { 'x-restli-id': 'urn:li:share:456' },
    }));

    const { linkedinPublishingAdapter } = await import('../platform/adapters/linkedin-publishing');
    await linkedinPublishingAdapter.publish(baseCommunityConnection, {
      ...request,
      destinationId: 'linkedin:linkedin:2414183',
    });

    const body = JSON.parse(fetchWithRetryMock.mock.calls[0][1].body);
    expect(body.author).toBe('urn:li:organization:2414183');
  });

  it('rejects Page publishing when the organization write scope is missing', async () => {
    const { linkedinPublishingAdapter } = await import('../platform/adapters/linkedin-publishing');
    const result = await linkedinPublishingAdapter.publish({
      ...baseCommunityConnection,
      metadata: {
        ...baseCommunityConnection.metadata,
        linkedinScopes: ['w_member_social'],
      },
    }, {
      ...request,
      destinationId: 'linkedin:linkedin:2414183',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('w_organization_social');
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });

  it('uploads multiple images and creates an organic multiImage post', async () => {
    let imageCounter = 0;
    fetchWithRetryMock.mockImplementation(async (url: string) => {
      if (url.includes('/images?action=initializeUpload')) {
        imageCounter += 1;
        return new Response(JSON.stringify({
          value: {
            uploadUrl: `https://upload.linkedin.test/${imageCounter}`,
            image: `urn:li:image:${imageCounter}`,
          },
        }), { status: 200 });
      }
      if (url.startsWith('https://cdn.example/')) {
        return new Response(Buffer.from([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      if (url.startsWith('https://upload.linkedin.test/')) {
        return new Response(null, { status: 201 });
      }
      if (url === 'https://api.linkedin.com/rest/posts') {
        return new Response(JSON.stringify({}), {
          status: 201,
          headers: { 'x-restli-id': 'urn:li:ugcPost:multi' },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { linkedinPublishingAdapter } = await import('../platform/adapters/linkedin-publishing');
    const result = await linkedinPublishingAdapter.publish(baseProfileConnection, {
      ...request,
      mediaUrls: ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'],
    });

    expect(result.success).toBe(true);
    const postCall = fetchWithRetryMock.mock.calls.find(([url]) => url === 'https://api.linkedin.com/rest/posts');
    const body = JSON.parse(postCall?.[1].body);
    expect(body.content).toEqual({
      multiImage: {
        images: [
          { id: 'urn:li:image:1' },
          { id: 'urn:li:image:2' },
        ],
      },
    });
  });
});
