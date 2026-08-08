export type {
  PlatformAdapter,
  PlatformConnection,
  PublishRequest,
  PublishResult,
} from './types';
export { PlatformCapability, ConnectionStatus } from './types';
export { getAdapter, getAdapterForChannel, listAdapters } from './registry';
export {
  getConnection,
  getConnectionRef,
  getConnectionRefById,
  getConnectionForChannel,
  getMetaConnectionMerged,
  getWorkspaceCredential,
  listAllConnectionDocs,
  listChannelConnections,
  listProviderConnections,
  listProviderCredentials,
  linkDestinationConnection,
  refForConnection,
  resolveAccessToken,
  saveConnection,
  deleteConnection,
  deleteConnectionById,
  listConnections,
  updateConnectionStatus,
  setConnectionStatus,
  markConnectionAuthError,
} from './connections';
export {
  buildConnectionId,
  connectionAccountKey,
  connectionAccountLabel,
  connectionCredentialKey,
  deriveAccountKey,
  deriveAccountLabel,
  deriveCredentialKey,
} from './connection-identity';
export { getAccessToken, getMeta } from './base-adapter';
