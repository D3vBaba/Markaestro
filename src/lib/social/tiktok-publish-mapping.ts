import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';

const TIKTOK_PUBLISH_MAPPING_COLLECTION = 'tiktok_publish_mappings';

export function tiktokPublishMappingDocId(publishId: string): string {
  return crypto.createHash('sha256').update(publishId).digest('hex');
}

export function getTikTokPublishMappingRef(publishId: string) {
  return adminDb.doc(`${TIKTOK_PUBLISH_MAPPING_COLLECTION}/${tiktokPublishMappingDocId(publishId)}`);
}
