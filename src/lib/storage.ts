/**
 * Firebase Storage upload utility.
 *
 * Replaces makePublic() with token-gated download URLs.
 * Files are NOT made publicly readable — a random download token is embedded
 * in the URL so only holders of the full URL can access the file.
 */

import crypto from 'crypto';

/**
 * Save a buffer to Firebase Storage and return a token-gated download URL.
 */
export async function uploadToStorage(
  filePath: string,
  buffer: Buffer,
  contentType: string,
  customMetadata?: Record<string, string>,
): Promise<string> {
  const admin = await import('firebase-admin');
  const bucket = admin.storage().bucket();
  const file = bucket.file(filePath);
  const downloadToken = crypto.randomUUID();

  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: {
        ...customMetadata,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  return buildDownloadUrl(bucket.name, filePath, downloadToken);
}

/** Save a private object without creating a tokenized public download URL. */
export async function uploadPrivateToStorage(
  filePath: string,
  buffer: Buffer,
  contentType: string,
  customMetadata?: Record<string, string>,
): Promise<string> {
  const admin = await import('firebase-admin');
  const bucket = admin.storage().bucket();
  await bucket.file(filePath).save(buffer, {
    resumable: false,
    metadata: { contentType, cacheControl: 'private, no-store', metadata: customMetadata },
  });
  return `gs://${bucket.name}/${filePath}`;
}

/** Best-effort prefix delete used when a workspace is purged. */
export async function deleteStoragePrefix(prefix: string): Promise<void> {
  const admin = await import('firebase-admin');
  const bucket = admin.storage().bucket();
  await bucket.deleteFiles({ prefix, force: true });
}

/**
 * Build a Firebase Storage download URL with an embedded access token.
 */
export function buildDownloadUrl(bucketName: string, filePath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}
