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
  /**
   * App-scoped id of the Facebook account that authorized this grant. Pages are
   * stamped with it so two connected Facebook accounts stay separated — one
   * account's grant must never refresh or re-token the other's Pages.
   */
  credentialKey?: string | null;
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
    ...(input.credentialKey ? { credentialKey: input.credentialKey } : {}),
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
 * A pending "pick a Page" document is only for brands that have no Page yet.
 * Writing one on top of linked Pages used to make a healthy channel look
 * yellow (the leftover grant sorted first and had no destination).
 */
export function shouldWritePendingMetaPageSelection(
  existing: Array<{ accountKey?: string | null; status?: string }>,
): boolean {
  return !existing.some((conn) => Boolean(conn.accountKey) && conn.status === 'connected');
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
      credentialKey: input.credentialKey,
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
    ...(input.credentialKey ? { credentialKey: input.credentialKey } : {}),
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
 * user reauthorizes Meta, refresh every linked Page the new grant covers.
 *
 * Facebook Login for Business asks which Pages to grant on every
 * authorization, and a Page left unticked genuinely loses access: Graph
 * validates the parent grant on every call, so that Page's stored token stops
 * working immediately. Pages outside a fully-enumerated grant are therefore
 * marked with an actionable message rather than left looking healthy while
 * every scheduled post fails.
 *
 * `grantIsComplete` is what makes this safe. It is true only when both
 * /me/accounts and the granular asset grant were read end to end, so a
 * truncated or partially-failed read can never mark another brand's Page.
 * Nothing is deleted either way — reconnecting and ticking the Page restores it.
 */
export async function syncGrantedMetaProductConnections(
  input: MetaCredential & {
    pages: MetaManagedPage[];
    /**
     * Whether `pages` is the full grant. A partial read must not overwrite the
     * cached Page list the picker shows.
     */
    grantIsComplete: boolean;
  },
): Promise<{ syncedProductIds: string[]; ungrantedProductIds: string[]; ungrantedPageNames: string[] }> {
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
  const ungrantedProductIds = new Set<string>();
  const ungrantedPageNames = new Set<string>();
  let writes = 0;

  for (const { productId, conn } of connections) {
    const pageId = typeof conn.metadata.pageId === 'string' ? conn.metadata.pageId : '';
    if (!pageId) continue;

    // A Page owned by a different Facebook account is none of this grant's
    // business. Pages linked before accounts were stamped have no owner
    // recorded, so they stay eligible.
    if (input.credentialKey && conn.credentialKey && conn.credentialKey !== input.credentialKey) {
      continue;
    }

    // Update the document this connection actually came from — a legacy
    // provider-keyed record still lives at its old id until it is rewritten.
    const ref = refForConnection(conn);
    const page = grantedPages.get(pageId);

    if (page) {
      // Page tokens do not expire, so a response that carried none can fall
      // back to the stored one. Only a connection with neither is unusable.
      const storedPageToken = typeof conn.metadata.pageAccessTokenEncrypted === 'string'
        ? conn.metadata.pageAccessTokenEncrypted
        : '';
      const hasUsableToken = Boolean(page.accessToken || storedPageToken);

      const update: Record<string, unknown> = {
        accessTokenEncrypted: encrypt(input.userAccessToken),
        status: hasUsableToken ? 'connected' : 'error',
        accountKey: pageId,
        accountLabel: page.name,
        connectionId: ref.id,
        ...(input.credentialKey ? { credentialKey: input.credentialKey } : {}),
        'metadata.pageName': page.name,
        ...(input.grantIsComplete ? { 'metadata.availablePages': availablePages } : {}),
        // The Page is granted — it just needs its token re-issued by
        // re-picking it, which is a different problem from losing access.
        'metadata.pageSelectionRequired': !hasUsableToken,
        'metadata.lastRefreshError': hasUsableToken
          ? null
          : 'Facebook did not return a token for this Page. Pick it again in brand settings.',
        'metadata.refreshFailureCount': hasUsableToken ? 0 : 1,
        updatedBy: input.userId,
        updatedAt: now,
      };
      if (page.accessToken) {
        update['metadata.pageAccessTokenEncrypted'] = encrypt(page.accessToken);
      }
      if (input.tokenExpiresAt) {
        update.tokenExpiresAt = input.tokenExpiresAt;
      }
      batch.update(ref, update);
      if (hasUsableToken) syncedProductIds.add(productId);
      writes++;
      continue;
    }

    // Absent from a fully-enumerated grant. Facebook Login for Business asset
    // selection means the user simply may not have ticked this Page this time —
    // either way the app can no longer publish to it, and the stored Page token
    // is dead. Say so plainly instead of leaving the tile green while every
    // scheduled post fails. The Page connection is kept so reconnecting and
    // ticking the Page restores it without relinking.
    if (!input.grantIsComplete) continue;

    batch.update(ref, {
      status: 'error',
      'metadata.pageSelectionRequired': false,
      'metadata.lastRefreshError':
        'Facebook no longer grants this Page to Markaestro. Reconnect Facebook and tick this Page in the permissions dialog.',
      'metadata.refreshFailureCount': 1,
      updatedBy: input.userId,
      updatedAt: now,
    });
    ungrantedProductIds.add(productId);
    ungrantedPageNames.add(
      typeof conn.metadata.pageName === 'string' && conn.metadata.pageName
        ? conn.metadata.pageName
        : pageId,
    );
    writes++;
  }

  if (writes > 0) {
    await batch.commit();
  }

  return {
    syncedProductIds: [...syncedProductIds],
    ungrantedProductIds: [...ungrantedProductIds],
    // Named so the connect flow can tell the user exactly what they dropped,
    // instead of letting them find out when a scheduled post fails.
    ungrantedPageNames: [...ungrantedPageNames],
  };
}
