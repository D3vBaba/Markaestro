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
  getConnectionForChannel,
  getMetaConnectionMerged,
  resolveAccessToken,
  saveConnection,
  deleteConnection,
  listConnections,
  updateConnectionStatus,
} from './connections';
export { getAccessToken, getMeta } from './base-adapter';
