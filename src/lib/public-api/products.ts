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
  id: string;
  provider: 'meta' | 'instagram' | 'tiktok';
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

export type ResolvedPublicDestination = {
  productId?: string;
  destinationId: string;
  destinationProvider: PublicProductDestination['provider'];
  deliveryMode: PublicProductDestination['deliveryMode'];
  willAlsoPublishTo: SocialChannel[];
};

type ProductRecord = {
  id: string;
  name?: string;
  status?: string;
  categories?: string[];
};

type WorkspaceDestination = {
  productId?: string;
  destination: PublicProductDestination;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildDestinationId(
  provider: PublicProductDestination['provider'],
  channel: SocialChannel,
  accountId: string,
) {
  return `${provider}:${channel}:${accountId}`;
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
      id: buildDestinationId('meta', 'facebook', pageId),
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
      id: buildDestinationId('meta', 'instagram', igAccountId),
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

function buildInstagramDestinations(connection: PlatformConnection | null, fallbackName: string): PublicProductDestination[] {
  if (!connection || connection.status !== 'connected') return [];

  const igAccountId = asString(connection.metadata.igAccountId);
  if (!igAccountId) return [];

  const username = asString(connection.metadata.username);
  const displayName =
    asString(connection.metadata.displayName) ||
    username ||
    fallbackName;

  return [{
    id: buildDestinationId('instagram', 'instagram', igAccountId),
    provider: 'instagram',
    channel: 'instagram',
    status: 'ready',
    displayName,
    accountId: igAccountId,
    igAccountId,
    username,
    deliveryMode: 'direct_publish',
    willAlsoPublishTo: [],
  }];
}

function buildTikTokDestinations(connection: PlatformConnection | null, fallbackName: string): PublicProductDestination[] {
  if (!connection || connection.status !== 'connected') return [];

  const username = asString(connection.metadata.username);
  const openId = asString(connection.metadata.openId);
  const displayName = username || fallbackName;
  const accountId = openId || username || connection.productId || connection.workspaceId;

  return [{
    id: buildDestinationId('tiktok', 'tiktok', accountId),
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

async function listWorkspaceLevelDestinations(
  workspaceId: string,
): Promise<WorkspaceDestination[]> {
  const metaConn = await getMetaConnectionMerged(workspaceId);
  return buildMetaDestinations(metaConn, 'Workspace').map((destination) => ({ destination }));
}

async function listAllProductDestinations(
  workspaceId: string,
): Promise<WorkspaceDestination[]> {
  const products = await listWorkspaceProducts(workspaceId);
  const items: WorkspaceDestination[] = [];

  for (const product of products) {
    const destinations = await listPublicProductDestinations(workspaceId, product.id);
    items.push(...destinations.map((destination) => ({
      productId: product.id,
      destination,
    })));
  }

  return items;
}

async function listWorkspaceDestinationsForChannel(
  workspaceId: string,
  channel: SocialChannel,
): Promise<WorkspaceDestination[]> {
  const [workspaceLevel, productLevel] = await Promise.all([
    listWorkspaceLevelDestinations(workspaceId),
    listAllProductDestinations(workspaceId),
  ]);

  return [...workspaceLevel, ...productLevel].filter((item) => item.destination.channel === channel);
}

function findDestinationById(
  items: WorkspaceDestination[],
  destinationId: string,
  channel: SocialChannel,
): WorkspaceDestination | null {
  return items.find((item) => item.destination.id === destinationId && item.destination.channel === channel) || null;
}

export async function listPublicProductDestinations(
  workspaceId: string,
  productId: string,
): Promise<PublicProductDestination[]> {
  const productSnap = await adminDb.doc(`${workspaceCollection(workspaceId, 'products')}/${productId}`).get();
  if (!productSnap.exists) throw new Error('NOT_FOUND');

  const product = productSnap.data() as ProductRecord;
  const fallbackName = product.name || productId;
  const [metaConn, instagramConn, tikTokConn] = await Promise.all([
    getMetaConnectionMerged(workspaceId, productId),
    getConnection(workspaceId, 'instagram', productId),
    getConnection(workspaceId, 'tiktok', productId),
  ]);

  return [
    ...buildMetaDestinations(metaConn, fallbackName),
    ...buildInstagramDestinations(instagramConn, fallbackName),
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

export async function resolvePublicPostDestination(
  workspaceId: string,
  channel: SocialChannel,
  productId?: string,
  destinationId?: string,
): Promise<ResolvedPublicDestination> {
  if (productId) {
    const productDestinations = await listPublicProductDestinations(workspaceId, productId);
    const matching = productDestinations.filter((destination) => destination.channel === channel);

    if (destinationId) {
      const destination = matching.find((item) => item.id === destinationId);
      if (!destination) {
        throw new Error('VALIDATION_DESTINATION_NOT_CONFIGURED_FOR_PRODUCT');
      }
      return {
        productId,
        destinationId: destination.id,
        destinationProvider: destination.provider,
        deliveryMode: destination.deliveryMode,
        willAlsoPublishTo: destination.willAlsoPublishTo,
      };
    }

    if (matching.length === 1) {
      const destination = matching[0];
      return {
        productId,
        destinationId: destination.id,
        destinationProvider: destination.provider,
        deliveryMode: destination.deliveryMode,
        willAlsoPublishTo: destination.willAlsoPublishTo,
      };
    }

    if (matching.length > 1) {
      throw new Error('VALIDATION_DESTINATION_ID_REQUIRED_FOR_CHANNEL');
    }

    throw new Error('VALIDATION_DESTINATION_NOT_CONFIGURED_FOR_PRODUCT');
  }

  const workspaceDestinations = await listWorkspaceDestinationsForChannel(workspaceId, channel);

  if (destinationId) {
    const destination = findDestinationById(workspaceDestinations, destinationId, channel);
    if (!destination) {
      throw new Error('VALIDATION_DESTINATION_NOT_CONFIGURED_FOR_CHANNEL');
    }

    return {
      productId: destination.productId,
      destinationId: destination.destination.id,
      destinationProvider: destination.destination.provider,
      deliveryMode: destination.destination.deliveryMode,
      willAlsoPublishTo: destination.destination.willAlsoPublishTo,
    };
  }

  if (workspaceDestinations.length === 1) {
    const only = workspaceDestinations[0];
    return {
      productId: only.productId,
      destinationId: only.destination.id,
      destinationProvider: only.destination.provider,
      deliveryMode: only.destination.deliveryMode,
      willAlsoPublishTo: only.destination.willAlsoPublishTo,
    };
  }

  if (workspaceDestinations.length > 1) {
    const distinctProductIds = new Set(
      workspaceDestinations.map((item) => item.productId || '__workspace__'),
    );
    if (distinctProductIds.size > 1) {
      throw new Error('VALIDATION_PRODUCT_ID_REQUIRED_FOR_CHANNEL');
    }
    throw new Error('VALIDATION_DESTINATION_ID_REQUIRED_FOR_CHANNEL');
  }

  const connection = await getConnectionForChannel(workspaceId, channel);
  if (!connection) {
    throw new Error('VALIDATION_DESTINATION_NOT_CONFIGURED_FOR_CHANNEL');
  }

  throw new Error('VALIDATION_DESTINATION_ID_REQUIRED_FOR_CHANNEL');
}

export async function resolvePublicPostProductId(
  workspaceId: string,
  channel: SocialChannel,
  productId?: string,
): Promise<string | undefined> {
  const resolved = await resolvePublicPostDestination(workspaceId, channel, productId);
  return resolved.productId;
}
