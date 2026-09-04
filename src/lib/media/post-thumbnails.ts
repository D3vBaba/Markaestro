import { adminDb } from '@/lib/firebase-admin';
import type { MediaAsset } from './asset-store';

const VIDEO_URL = /\.(mp4|mov|webm|m4v)(\?|$)/i;

export function isVideoMediaUrl(url: string): boolean {
  return VIDEO_URL.test(url);
}

type PostLike = { id: string } & Record<string, unknown>;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

/**
 * Give every post a `thumbnailUrl` the UI can show without knowing how the
 * media was stored: a platform-provided thumbnail wins, then the first image
 * in `mediaUrls`, then the derived thumbnail of the first media asset (which
 * is how video posts get a poster frame). Posts with nothing to show get null,
 * so the UI can fall back to a channel glyph deliberately rather than by
 * accident.
 */
export async function attachPostThumbnails<T extends PostLike>(
  workspaceId: string,
  posts: T[],
): Promise<Array<T & { thumbnailUrl: string | null }>> {
  const needAsset = new Map<string, string>();
  const resolved = posts.map((post) => {
    const existing = typeof post.thumbnailUrl === 'string' && post.thumbnailUrl.trim() ? post.thumbnailUrl.trim() : null;
    if (existing) return { ...post, thumbnailUrl: existing };
    const image = strings(post.mediaUrls).find((url) => !isVideoMediaUrl(url));
    if (image) return { ...post, thumbnailUrl: image };
    const assetId = strings(post.mediaAssetIds)[0];
    if (assetId) needAsset.set(post.id, assetId);
    return { ...post, thumbnailUrl: null };
  });
  if (needAsset.size === 0) return resolved;

  const ids = [...new Set(needAsset.values())];
  const byAsset = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const snaps = await adminDb.getAll(...chunk.map((id) => adminDb.doc(`workspaces/${workspaceId}/media_assets/${id}`)));
    snaps.forEach((snap, index) => {
      const data = snap.exists ? (snap.data() as Partial<MediaAsset>) : null;
      const thumb = data?.thumbnailUrl ?? (data?.type === 'image' ? data.downloadUrl ?? null : null);
      byAsset.set(chunk[index], thumb ?? null);
    });
  }
  return resolved.map((post) => {
    const assetId = needAsset.get(post.id);
    return assetId ? { ...post, thumbnailUrl: byAsset.get(assetId) ?? null } : post;
  });
}
