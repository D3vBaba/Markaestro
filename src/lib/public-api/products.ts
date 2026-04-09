import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { getConnection, getConnectionForChannel, getMetaConnectionMerged } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';

export type PublicProductSummary = {
  id: string;
  name: string;
  status: string;
  categories: string[];
  availableChannels: SocialChannel[];
  destinationsCount: number;
};

export type PublicProductDestination = {
  provider: 'meta' | 'tiktok';
  channel: SocialChannel;
  status: 'ready';
  displayName: string;
  accountId: string;
  pageId?: string | null;
  igAccountId?: string | null;
  username?: string | null;
  deliveryMode: 'direct_publish' | 'user_review';
  willAlsoPublishTo: SocialChannel[];
};

type ProductRecord = {
  id: string;
  name?: string;
  status?: string;
  categories?: string[];
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function listWorkspaceProducts(workspaceId: string): Promise<ProductRecord[]> {
  const snap = await adminDb
    .collection(workspaceCollection(workspaceId, 'products'))
    .orderBy('createdAt', 'asc')
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  }));
}

function buildMetaDestinations(connection: PlatformConnection | null, fallbackName: string): PublicProductDestination[] {
  if (!connection || connection.status !== 'connected') return [];

  const pageId = asString(connection.metadata.pageId);
  const pageName = asString(connection.metadata.pageName) || fallbackName;
  const igAccountId = asString(connection.metadata.igAccountId);
  const destinations: PublicProductDestination[] = [];

  if (pageId) {
    destinations.push({
      provider: 'meta',
      channel: 'facebook',
      status: 'ready',
      displayName: pageName,
      accountId: pageId,
      pageId,
      igAccountId,
      deliveryMode: 'direct_publish',
      willAlsoPublishTo: igAccountId ? ['instagram'] : [],
    });
  }

  if (igAccountId) {
    destinations.push({
      provider: 'meta',
      channel: 'instagram',
      status: 'ready',
      displayName: pageName,
      accountId: igAccountId,
      pageId,
      igAccountId,
      deliveryMode: 'direct_publish',
      willAlsoPublishTo: pageId ? ['facebook'] : [],
    });
  }

  return destinations;
}

function buildTikTokDestinations(connection: PlatformConnection | null, fallbackName: string): PublicProductDestination[] {
  if (!connection || connection.status !== 'connected') return [];

  const username = asString(connection.metadata.username);
  const openId = asString(connection.metadata.openId);
  const displayName = username || fallbackName;
  const accountId = openId || username || connection.productId || connection.workspaceId;

  return [{
    provider: 'tiktok',
    channel: 'tiktok',
    status: 'ready',
    displayName,
    accountId,
    username,
    deliveryMode: 'user_review',
    willAlsoPublishTo: [],
  }];
}

export async function listPublicProductDestinations(
  workspaceId: string,
  productId: string,
): Promise<PublicProductDestination[]> {
  const productSnap = await adminDb.doc(`${workspaceCollection(workspaceId, 'products')}/${productId}`).get();
  if (!productSnap.exists) throw new Error('NOT_FOUND');

  const product = productSnap.data() as ProductRecord;
  const fallbackName = product.name || productId;
  const [metaConn, tikTokConn] = await Promise.all([
    getMetaConnectionMerged(workspaceId, productId),
    getConnection(workspaceId, 'tiktok', productId),
  ]);

  return [
    ...buildMetaDestinations(metaConn, fallbackName),
    ...buildTikTokDestinations(tikTokConn, fallbackName),
  ];
}

export async function listPublicProducts(workspaceId: string): Promise<PublicProductSummary[]> {
  const products = await listWorkspaceProducts(workspaceId);

  const summaries = await Promise.all(products.map(async (product) => {
    const destinations = await listPublicProductDestinations(workspaceId, product.id);
    const availableChannels = Array.from(
      new Set(destinations.map((destination) => destination.channel)),
    ) as SocialChannel[];

    return {
      id: product.id,
      name: product.name || product.id,
      status: product.status || 'active',
      categories: Array.isArray(product.categories)
        ? product.categories.filter((category): category is string => typeof category === 'string')
        : [],
      availableChannels,
      destinationsCount: destinations.length,
    } satisfies PublicProductSummary;
  }));

  return summaries;
}

async function hasWorkspaceLevelDestinationForChannel(
  workspaceId: string,
  channel: SocialChannel,
): Promise<boolean> {
  if (channel === 'facebook' || channel === 'instagram') {
    const metaConn = await getMetaConnectionMerged(workspaceId);
    if (!metaConn || metaConn.status !== 'connected') return false;
    if (channel === 'facebook') return Boolean(asString(metaConn.metadata.pageId));
    return Boolean(asString(metaConn.metadata.igAccountId));
  }

  const connection = await getConnection(workspaceId, 'tiktok');
  return Boolean(connection && connection.status === 'connected');
}

async function listProductIdsWithChannel(
  workspaceId: string,
  channel: SocialChannel,
): Promise<string[]> {
  const products = await listWorkspaceProducts(workspaceId);
  const matchingProductIds: string[] = [];

  for (const product of products) {
    const destinations = await listPublicProductDestinations(workspaceId, product.id);
    if (destinations.some((destination) => destination.channel === channel)) {
      matchingProductIds.push(product.id);
    }
  }

  return matchingProductIds;
}

export async function resolvePublicPostProductId(
  workspaceId: string,
  channel: SocialChannel,
  productId?: string,
): Promise<string | undefined> {
  if (productId) {
    const destinations = await listPublicProductDestinations(workspaceId, productId);
    if (!destinations.some((destination) => destination.channel === channel)) {
      throw new Error('VALIDATION_DESTINATION_NOT_CONFIGURED_FOR_PRODUCT');
    }
    return productId;
  }

  if (await hasWorkspaceLevelDestinationForChannel(workspaceId, channel)) {
    return undefined;
  }

  const matchingProductIds = await listProductIdsWithChannel(workspaceId, channel);
  if (matchingProductIds.length === 1) {
    return matchingProductIds[0];
  }
  if (matchingProductIds.length > 1) {
    throw new Error('VALIDATION_PRODUCT_ID_REQUIRED_FOR_CHANNEL');
  }

  const connection = await getConnectionForChannel(workspaceId, channel);
  if (!connection) {
    throw new Error('VALIDATION_DESTINATION_NOT_CONFIGURED_FOR_CHANNEL');
  }

  return connection.productId;
}
