import { z } from 'zod';

/**
 * Platform-specific post settings.
 *
 * Discriminated by `__type` (matches the social channel id). Each variant
 * carries options that are meaningful only to that platform. Settings are
 * persisted verbatim on the post and read by the adapter at publish time.
 */

// ── TikTok ────────────────────────────────────────────────────────
//
// privacy / disable_comment / disable_duet / disable_stitch are only
// honored by TikTok's Direct Post mode. Markaestro currently publishes
// via MEDIA_UPLOAD (creator finishes in the TikTok inbox), so these
// fields are accepted for forward-compat once we get TikTok Direct Post
// audit approval. `photo_cover_index` IS honored today for photo
// carousels.
export const tiktokPrivacyLevels = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
] as const;

export const tiktokSettingsSchema = z.object({
  __type: z.literal('tiktok'),
  privacyLevel: z.enum(tiktokPrivacyLevels).optional(),
  disableComment: z.boolean().optional(),
  disableDuet: z.boolean().optional(),
  disableStitch: z.boolean().optional(),
  photoCoverIndex: z.number().int().min(0).max(9).optional(),
});

// ── Instagram ─────────────────────────────────────────────────────

export const instagramPostTypes = ['feed', 'reel', 'story'] as const;

export const instagramSettingsSchema = z.object({
  __type: z.literal('instagram'),
  postType: z.enum(instagramPostTypes).optional(),
  collaborators: z.array(z.string().trim().min(1).max(60)).max(3).optional(),
  altText: z.array(z.string().trim().max(1000)).max(10).optional(),
});

// ── YouTube ───────────────────────────────────────────────────────

export const youtubePrivacyStatuses = ['public', 'unlisted', 'private'] as const;

export const youtubeSettingsSchema = z.object({
  __type: z.literal('youtube'),
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(15).optional(),
  categoryId: z.string().trim().regex(/^\d{1,3}$/, 'YouTube categoryId must be numeric').optional(),
  privacyStatus: z.enum(youtubePrivacyStatuses).optional(),
  madeForKids: z.boolean().optional(),
  thumbnailUrl: z.string().url().max(2048).optional(),
});

// ── Discriminated union ───────────────────────────────────────────

export const postSettingsSchema = z.discriminatedUnion('__type', [
  tiktokSettingsSchema,
  instagramSettingsSchema,
  youtubeSettingsSchema,
]);

export type TikTokSettings = z.infer<typeof tiktokSettingsSchema>;
export type InstagramSettings = z.infer<typeof instagramSettingsSchema>;
export type YouTubeSettings = z.infer<typeof youtubeSettingsSchema>;
export type PostSettings = z.infer<typeof postSettingsSchema>;

/**
 * Type guards for adapters: each adapter can narrow a generic settings
 * object to its own typed view without circular imports.
 */
export function asTikTokSettings(settings: unknown): TikTokSettings | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const s = settings as { __type?: string };
  return s.__type === 'tiktok' ? (settings as TikTokSettings) : undefined;
}

export function asInstagramSettings(settings: unknown): InstagramSettings | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const s = settings as { __type?: string };
  return s.__type === 'instagram' ? (settings as InstagramSettings) : undefined;
}

export function asYouTubeSettings(settings: unknown): YouTubeSettings | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const s = settings as { __type?: string };
  return s.__type === 'youtube' ? (settings as YouTubeSettings) : undefined;
}

/**
 * Validate that a settings object's `__type` matches the post's channel.
 * Throws VALIDATION_SETTINGS_CHANNEL_MISMATCH otherwise.
 */
export function assertSettingsMatchesChannel(channel: string, settings: PostSettings | undefined) {
  if (!settings) return;
  if (settings.__type !== channel) {
    throw new Error('VALIDATION_SETTINGS_CHANNEL_MISMATCH');
  }
}
