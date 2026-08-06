import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { encrypt } from '@/lib/crypto';
import { PlatformCapability } from '@/lib/platform/types';
import type { PlatformConnection } from '@/lib/platform/types';
import type { MetaManagedPage } from '@/lib/meta-pages';

const META_CHANNELS = ['facebook'] as const;
const META_CAPABILITIES = [
  PlatformCapability.PUBLISH_TEXT,
  PlatformCapability.PUBLISH_IMAGE,
  PlatformCapability.PUBLISH_CAROUSEL,
];

type MetaCredential = {
  workspaceId: string;
  userId: string;
  userAccessToken: string;
  tokenExpiresAt?: string;
};

type MetaPageSelectionInput = MetaCredential & {
  productId: string;
  page: MetaManagedPage;
  availablePages?: MetaManagedPage[];
};

export async function saveMetaProductPageSelection(
  input: MetaPageSelectionInput,
): Promise<void> {
  if (!input.page.accessToken) {
    throw new Error('Selected Facebook Page did not return an access token');
  }

  const ref = adminDb.doc(
    `workspaces/${input.workspaceId}/products/${input.productId}/platformConnections/meta`,
  );
  const existingSnap = await ref.get();
  const existing = existingSnap.exists
    ? (existingSnap.data() as Partial<PlatformConnection>)
    : null;
  const now = new Date().toISOString();
  const availablePages = (input.availablePages || [input.page]).map((page) => ({
    id: page.id,
    name: page.name,
  }));

  await ref.set({
    provider: 'meta',
    channels: [...META_CHANNELS],
    capabilities: META_CAPABILITIES,
    status: 'connected',
    accessTokenEncrypted: encrypt(input.userAccessToken),
    ...(input.tokenExpiresAt ? { tokenExpiresAt: input.tokenExpiresAt } : {}),
    metadata: {
      pageId: input.page.id,
      pageName: input.page.name,
      pageAccessTokenEncrypted: encrypt(input.page.accessToken),
      availablePages,
      igAccountId: null,
      pageSelectionRequired: false,
      lastRefreshError: null,
      refreshFailureCount: 0,
    },
    workspaceId: input.workspaceId,
    productId: input.productId,
    updatedBy: input.userId,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  }, { merge: true });
}

export async function markMetaProductPageSelectionRequired(
  input: MetaCredential & {
    productId: string;
    availablePages?: MetaManagedPage[];
  },
): Promise<void> {
  const ref = adminDb.doc(
    `workspaces/${input.workspaceId}/products/${input.productId}/platformConnections/meta`,
  );
  const existingSnap = await ref.get();
  const existing = existingSnap.exists
    ? (existingSnap.data() as Partial<PlatformConnection>)
    : null;
  const now = new Date().toISOString();

  await ref.set({
    provider: 'meta',
    channels: [...META_CHANNELS],
    capabilities: META_CAPABILITIES,
    status: 'connected',
    accessTokenEncrypted: encrypt(input.userAccessToken),
    ...(input.tokenExpiresAt ? { tokenExpiresAt: input.tokenExpiresAt } : {}),
    metadata: {
      availablePages: (input.availablePages || []).map((page) => ({
        id: page.id,
        name: page.name,
      })),
      pageSelectionRequired: true,
      lastRefreshError: null,
      refreshFailureCount: 0,
    },
    workspaceId: input.workspaceId,
    productId: input.productId,
    updatedBy: input.userId,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  }, { merge: true });
}

/**
 * A Facebook Login token is app-user scoped, not product scoped. Whenever a
 * user reauthorizes Meta, refresh every existing product whose selected Page
 * is still part of the grant and clearly revoke products whose Page was
 * removed from the grant.
 */
export async function syncGrantedMetaProductConnections(
  input: MetaCredential & { pages: MetaManagedPage[] },
): Promise<{ syncedProductIds: string[]; revokedProductIds: string[] }> {
  const grantedPages = new Map(
    input.pages.map((page) => [page.id, page]),
  );
  const availablePages = input.pages.map((page) => ({
    id: page.id,
    name: page.name,
  }));
  const productsSnap = await adminDb
    .collection(`workspaces/${input.workspaceId}/products`)
    .get();
  const connectionRefs = productsSnap.docs.map((product) =>
    adminDb.doc(
      `workspaces/${input.workspaceId}/products/${product.id}/platformConnections/meta`,
    ),
  );
  const connectionSnaps = await Promise.all(connectionRefs.map((ref) => ref.get()));
  const batch = adminDb.batch();
  const now = new Date().toISOString();
  const syncedProductIds: string[] = [];
  const revokedProductIds: string[] = [];
  let writes = 0;

  connectionSnaps.forEach((snap, index) => {
    if (!snap.exists) return;

    const connection = snap.data() as PlatformConnection;
    const pageId = typeof connection.metadata.pageId === 'string'
      ? connection.metadata.pageId
      : '';
    if (!pageId) return;

    const page = grantedPages.get(pageId);
    const productId = productsSnap.docs[index].id;
    if (page?.accessToken) {
      const update: Record<string, unknown> = {
        accessTokenEncrypted: encrypt(input.userAccessToken),
        status: 'connected',
        'metadata.pageName': page.name,
        'metadata.pageAccessTokenEncrypted': encrypt(page.accessToken),
        'metadata.availablePages': availablePages,
        'metadata.pageSelectionRequired': false,
        'metadata.lastRefreshError': null,
        'metadata.refreshFailureCount': 0,
        updatedBy: input.userId,
        updatedAt: now,
      };
      if (input.tokenExpiresAt) {
        update.tokenExpiresAt = input.tokenExpiresAt;
      }
      batch.update(connectionRefs[index], update);
      syncedProductIds.push(productId);
      writes++;
      return;
    }

    batch.update(connectionRefs[index], {
      status: 'revoked',
      'metadata.pageAccessTokenEncrypted': FieldValue.delete(),
      'metadata.availablePages': availablePages,
      'metadata.pageSelectionRequired': true,
      'metadata.lastRefreshError':
        'This Facebook Page is not included in the current Markaestro Page permissions.',
      'metadata.refreshFailureCount': 1,
      updatedBy: input.userId,
      updatedAt: now,
    });
    revokedProductIds.push(productId);
    writes++;
  });

  if (writes > 0) {
    await batch.commit();
  }

  return { syncedProductIds, revokedProductIds };
}
