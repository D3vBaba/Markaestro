import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { encrypt } from '@/lib/crypto';
import { PlatformCapability } from '@/lib/platform/types';
import type { PlatformConnection } from '@/lib/platform/types';
import type { MetaManagedPage } from '@/lib/meta-pages';
import {
  getConnectionRef,
  listProviderConnections,
  refForConnection,
} from '@/lib/platform/connections';
import { buildConnectionId } from '@/lib/platform/connection-identity';

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

/**
 * Link one Facebook Page to a brand. Each Page is its own connection document
 * (`meta:{pageId}`), so a Facebook account managing ten Pages can have all ten
 * linked at once — selecting one never displaces another.
 */
export async function saveMetaProductPageSelection(
  input: MetaPageSelectionInput,
): Promise<void> {
  if (!input.page.accessToken) {
    throw new Error('Selected Facebook Page did not return an access token');
  }

  const ref = getConnectionRef(input.workspaceId, 'meta', input.productId, input.page.id);
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
    connectionId: ref.id,
    accountKey: input.page.id,
    accountLabel: input.page.name,
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

  await retireLegacyMetaProductConnection(input.workspaceId, input.productId, input.page.id);
}

/**
 * Link several Pages to a brand in one call and, when `exclusive` is set, unlink
 * any Page the user cleared in the picker.
 */
export async function setMetaProductPageSelections(
  input: MetaCredential & {
    productId: string;
    pages: MetaManagedPage[];
    availablePages?: MetaManagedPage[];
    exclusive?: boolean;
  },
): Promise<{ linkedPageIds: string[]; unlinkedPageIds: string[] }> {
  const linkedPageIds: string[] = [];

  for (const page of input.pages) {
    if (!page.accessToken) continue;
    await saveMetaProductPageSelection({
      workspaceId: input.workspaceId,
      productId: input.productId,
      userId: input.userId,
      userAccessToken: input.userAccessToken,
      tokenExpiresAt: input.tokenExpiresAt,
      page,
      availablePages: input.availablePages || input.pages,
    });
    linkedPageIds.push(page.id);
  }

  const unlinkedPageIds: string[] = [];
  if (input.exclusive) {
    const keep = new Set(linkedPageIds);
    const existing = await listProviderConnections(input.workspaceId, 'meta', input.productId);
    for (const conn of existing) {
      const pageId = typeof conn.metadata.pageId === 'string' ? conn.metadata.pageId : '';
      if (!pageId || keep.has(pageId)) continue;
      await getConnectionRef(input.workspaceId, 'meta', input.productId, pageId).delete();
      unlinkedPageIds.push(pageId);
    }
  }

  return { linkedPageIds, unlinkedPageIds };
}

/**
 * A legacy single-slot `meta` product document is superseded once the Page it
 * pointed at (or the pending selection it represented) exists under its own id.
 */
async function retireLegacyMetaProductConnection(
  workspaceId: string,
  productId: string,
  pageId: string,
): Promise<void> {
  const legacyRef = getConnectionRef(workspaceId, 'meta', productId);
  if (legacyRef.id === buildConnectionId('meta', pageId)) return;

  const snap = await legacyRef.get();
  if (!snap.exists) return;

  const data = snap.data() as Partial<PlatformConnection>;
  const legacyPageId = typeof data.metadata?.pageId === 'string' ? data.metadata.pageId : '';
  if (legacyPageId && legacyPageId !== pageId) return;

  await legacyRef.delete();
}

/**
 * Record that a brand has a usable Meta grant but no Page picked yet. This is
 * the pending document — it owns no destination and is superseded as soon as
 * the first Page is linked.
 */
export async function markMetaProductPageSelectionRequired(
  input: MetaCredential & {
    productId: string;
    availablePages?: MetaManagedPage[];
  },
): Promise<void> {
  const ref = getConnectionRef(input.workspaceId, 'meta', input.productId);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists
    ? (existingSnap.data() as Partial<PlatformConnection>)
    : null;
  const now = new Date().toISOString();

  await ref.set({
    provider: 'meta',
    connectionId: ref.id,
    accountKey: null,
    accountLabel: null,
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
 * user reauthorizes Meta, refresh every linked Page whose grant still covers it
 * and clearly revoke Pages that were removed from the grant.
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

  const connections = (await Promise.all(
    productsSnap.docs.map(async (product) => ({
      productId: product.id,
      conns: await listProviderConnections(input.workspaceId, 'meta', product.id),
    })),
  )).flatMap(({ productId, conns }) => conns.map((conn) => ({ productId, conn })));

  const batch = adminDb.batch();
  const now = new Date().toISOString();
  const syncedProductIds = new Set<string>();
  const revokedProductIds = new Set<string>();
  let writes = 0;

  for (const { productId, conn } of connections) {
    const pageId = typeof conn.metadata.pageId === 'string' ? conn.metadata.pageId : '';
    if (!pageId) continue;

    // Update the document this connection actually came from — a legacy
    // provider-keyed record still lives at its old id until it is rewritten.
    const ref = refForConnection(conn);
    const page = grantedPages.get(pageId);

    if (page?.accessToken) {
      const update: Record<string, unknown> = {
        accessTokenEncrypted: encrypt(input.userAccessToken),
        status: 'connected',
        accountKey: pageId,
        accountLabel: page.name,
        connectionId: ref.id,
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
      batch.update(ref, update);
      syncedProductIds.add(productId);
      writes++;
      continue;
    }

    batch.update(ref, {
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
    revokedProductIds.add(productId);
    writes++;
  }

  if (writes > 0) {
    await batch.commit();
  }

  return {
    syncedProductIds: [...syncedProductIds],
    revokedProductIds: [...revokedProductIds],
  };
}
