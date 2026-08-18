import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { getConnection, getConnectionForChannel, listProviderConnections } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import { getStoredLinkedInDestinations } from '@/lib/platform/linkedin-api';
import {
  LINKEDIN_COMMUNITY_PROVIDER,
  LINKEDIN_PROFILE_PROVIDER,
} from '@/lib/platform/linkedin-providers';

export type PublicProductSummary = {
  id: string;
  name: string;
  status: string;
  categories: string[];
  availableChannels: SocialChannel[];
  destinationsCount: number;
};

export type PublicProductCatalogEntry = {
  product: PublicProductSummary;
  destinations: PublicProductDestination[];
};

export type PublicProductDestination = {
  id: string;
  provider: 'meta' | 'instagram' | 'tiktok' | 'threads' | 'linkedin';
  channel: SocialChannel;
  status: 'ready';
  displayName: string;
  accountId: string;
  pageId?: string | null;
  igAccountId?: string | null;
  username?: string | null;
  deliveryMode: 'direct_publish' | 'platform_inbox';
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
      deliveryMode: 'direct_publish',
      // Facebook is its own dedicated path — no cross-channel fan-out to Instagram.
      willAlsoPublishTo: [],
    });
  }

  // Meta provides only the Facebook destination. Instagram is linked separately
  // via Instagram Login (buildInstagramDestinations), never from the Page here.
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

function buildTikTokDestinations(
  scopeId: string,
  connection: PlatformConnection | null,
  fallbackName: string,
): PublicProductDestination[] {
  if (!connection || connection.status !== 'connected') return [];

  const openId = asString(connection.metadata.openId);
  const username = asString(connection.metadata.username);
  const displayName =
    asString(connection.metadata.displayName) ||
    username ||
    fallbackName;
  const accountId = openId || username || scopeId;

  return [{
    id: buildDestinationId('tiktok', 'tiktok', accountId),
    provider: 'tiktok',
    channel: 'tiktok',
    status: 'ready',
    displayName,
    accountId,
    username,
    deliveryMode: 'platform_inbox',
    willAlsoPublishTo: [],
  }];
}

function buildThreadsDestinations(connection: PlatformConnection | null, fallbackName: string): PublicProductDestination[] {
  if (!connection || connection.status !== 'connected') return [];

  const threadsUserId = asString(connection.metadata.threadsUserId);
  if (!threadsUserId) return [];

  const username = asString(connection.metadata.username);
  const displayName = asString(connection.metadata.displayName) || username || fallbackName;

  return [{
    id: buildDestinationId('threads', 'threads', threadsUserId),
    provider: 'threads',
    channel: 'threads',
    status: 'ready',
    displayName,
    accountId: threadsUserId,
    username,
    deliveryMode: 'direct_publish',
    // Threads is its own dedicated path.
    willAlsoPublishTo: [],
  }];
}

function buildLinkedInDestinations(connection: PlatformConnection | null, fallbackName: string): PublicProductDestination[] {
  if (!connection || connection.status !== 'connected') return [];

  return getStoredLinkedInDestinations(connection).map((destination) => ({
    id: buildDestinationId('linkedin', 'linkedin', destination.id),
    provider: 'linkedin',
    channel: 'linkedin',
    status: 'ready',
    displayName: destination.name || fallbackName,
    accountId: destination.id,
    username: destination.type === 'profile' ? destination.name : null,
    pageId: destination.type === 'page' ? destination.id : null,
    deliveryMode: 'direct_publish',
    willAlsoPublishTo: [],
  }));
}

async function listWorkspaceLevelDestinations(
  workspaceId: string,
): Promise<WorkspaceDestination[]> {
  const metaConns = await listProviderConnections(workspaceId, 'meta');
  return metaConns
    .flatMap((conn) => buildMetaDestinations(conn, 'Workspace'))
    .map((destination) => ({ destination }));
}

async function listAllProductDestinations(
  workspaceId: string,
): Promise<WorkspaceDestination[]> {
  const [products, metaCredential] = await Promise.all([
    listWorkspaceProducts(workspaceId),
    getConnection(workspaceId, 'meta'),
  ]);
  const groups = await Promise.all(products.map(async (product) => {
    const destinations = await listPublicProductDestinations(
      workspaceId,
      product.id,
      product,
      metaCredential,
    );
    return destinations.map((destination) => ({ productId: product.id, destination }));
  }));
  return groups.flat();
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
  knownProduct?: ProductRecord,
  knownWorkspaceMetaCredential?: PlatformConnection | null,
): Promise<PublicProductDestination[]> {
  let product = knownProduct;
  if (!product) {
    const productSnap = await adminDb.doc(`${workspaceCollection(workspaceId, 'products')}/${productId}`).get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');
    product = { id: productId, ...(productSnap.data() as Record<string, unknown>) } as ProductRecord;
  }
  const fallbackName = product.name || productId;
  // A brand can link several accounts per provider (ten Facebook Pages, two
  // Instagram accounts, …) — every one of them is a publishable destination.
  const [metaConns, instagramConns, tikTokConns, threadsConns, linkedInProfileConns, linkedInCommunityConns, linkedInLegacyConns] = await Promise.all([
    listProviderConnections(workspaceId, 'meta', productId),
    listProviderConnections(workspaceId, 'instagram', productId),
    listProviderConnections(workspaceId, 'tiktok', productId),
    listProviderConnections(workspaceId, 'threads', productId),
    listProviderConnections(workspaceId, LINKEDIN_PROFILE_PROVIDER, productId),
    listProviderConnections(workspaceId, LINKEDIN_COMMUNITY_PROVIDER, productId),
    listProviderConnections(workspaceId, 'linkedin', productId),
  ]);

  const metaCredential = knownWorkspaceMetaCredential === undefined
    ? await getConnection(workspaceId, 'meta')
    : knownWorkspaceMetaCredential;
  const mergedMetaConns = metaConns.map((conn) => (metaCredential
    ? { ...conn, metadata: { ...metaCredential.metadata, ...conn.metadata } }
    : conn));

  return [
    ...mergedMetaConns.flatMap((conn) => buildMetaDestinations(conn, fallbackName)),
    ...instagramConns.flatMap((conn) => buildInstagramDestinations(conn, fallbackName)),
    ...tikTokConns.flatMap((conn) => buildTikTokDestinations(productId, conn, fallbackName)),
    ...threadsConns.flatMap((conn) => buildThreadsDestinations(conn, fallbackName)),
    ...linkedInProfileConns.flatMap((conn) => buildLinkedInDestinations(conn, fallbackName)),
    ...linkedInCommunityConns.flatMap((conn) => buildLinkedInDestinations(conn, fallbackName)),
    ...(linkedInProfileConns.length > 0 || linkedInCommunityConns.length > 0
      ? []
      : linkedInLegacyConns.flatMap((conn) => buildLinkedInDestinations(conn, fallbackName))),
  ];
}

export async function listPublicProductCatalog(
  workspaceId: string,
  boundProductId?: string,
): Promise<PublicProductCatalogEntry[]> {
  let products: ProductRecord[];
  if (boundProductId) {
    const snap = await adminDb.doc(`${workspaceCollection(workspaceId, 'products')}/${boundProductId}`).get();
    products = snap.exists
      ? [{ id: snap.id, ...(snap.data() as Record<string, unknown>) } as ProductRecord]
      : [];
  } else {
    products = await listWorkspaceProducts(workspaceId);
  }

  const metaCredential = await getConnection(workspaceId, 'meta');
  return Promise.all(products.map(async (product) => {
    const destinations = await listPublicProductDestinations(
      workspaceId,
      product.id,
      product,
      metaCredential,
    );
    const availableChannels = Array.from(
      new Set(destinations.map((destination) => destination.channel)),
    ) as SocialChannel[];

    return {
      product: {
        id: product.id,
        name: product.name || product.id,
        status: product.status || 'active',
        categories: Array.isArray(product.categories)
          ? product.categories.filter((category): category is string => typeof category === 'string')
          : [],
        availableChannels,
        destinationsCount: destinations.length,
      },
      destinations,
    } satisfies PublicProductCatalogEntry;
  }));
}

export async function listPublicProducts(workspaceId: string): Promise<PublicProductSummary[]> {
  const catalog = await listPublicProductCatalog(workspaceId);
  return catalog.map((entry) => entry.product);
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
