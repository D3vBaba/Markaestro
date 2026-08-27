import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));

import { nativeSocialPostFields } from '@/lib/intelligence/canonical-social-posts';
import type { PlatformConnection, PlatformPostSummary } from '@/lib/platform/types';

const connection = {
  provider: 'instagram',
  productId: 'brand_1',
  accountKey: 'ig_1',
  metadata: {},
} as unknown as PlatformConnection;

const post: PlatformPostSummary = {
  externalId: 'ext_9',
  channel: 'instagram',
  content: 'native caption',
  mediaType: 'image',
  mediaUrl: null,
  thumbnailUrl: null,
  permalink: 'https://instagram.com/p/x',
  publishedAt: '2026-08-01T12:00:00Z',
  canDelete: false,
};

describe('native social post import', () => {
  it('does not overwrite Markaestro provenance or authored copy', () => {
    const fields = nativeSocialPostFields({
      existing: {
        provenance: 'markaestro',
        markaestroPostId: 'post_1',
        campaignId: 'camp_1',
        content: 'draft from Markaestro',
        productId: 'brand_1',
      },
      workspaceId: 'ws_1',
      productId: 'brand_1',
      connection,
      post,
      discoveredAt: '2026-08-25T12:00:00Z',
    });
    expect(fields.provenance).toBe('markaestro');
    expect(fields.markaestroPostId).toBe('post_1');
    expect(fields.campaignId).toBe('camp_1');
    expect(fields.content).toBe('draft from Markaestro');
  });
});
