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
// TikTok has two publishing flows and `postMode` picks between them:
//
//   'inbox' (default)  — MEDIA_UPLOAD / inbox hand-off. The creator finishes
//                        caption, privacy, and posting inside the TikTok app.
//                        privacy / disable_* are accepted but not honored,
//                        because TikTok ignores them in this mode.
//   'direct_post'      — Direct Post. Publishes straight to the creator's
//                        profile, so privacy / disable_* / the commercial
//                        disclosure fields are all honored and required.
//
// Omitting `postMode` keeps the inbox behavior, so posts written before
// Direct Post existed are unaffected.
//
// `photoCoverIndex` is honored in both modes for photo carousels.
export const tiktokPostModes = ['inbox', 'direct_post'] as const;

export const tiktokPrivacyLevels = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
] as const;

export const tiktokSettingsSchema = z.object({
  __type: z.literal('tiktok'),
  postMode: z.enum(tiktokPostModes).optional(),
  privacyLevel: z.enum(tiktokPrivacyLevels).optional(),
  disableComment: z.boolean().optional(),
  disableDuet: z.boolean().optional(),
  disableStitch: z.boolean().optional(),
  photoCoverIndex: z.number().int().min(0).max(9).optional(),
  /**
   * TikTok's commercial content disclosure. `commercialContentDisclosure` is
   * the parent toggle; at least one of the two labels below must be set when
   * it is on. Maps to TikTok's `brand_organic_toggle` ("Your brand" —
   * "Promotional content") and `brand_content_toggle` ("Branded content" —
   * "Paid partnership"). Direct Post only.
   */
  commercialContentDisclosure: z.boolean().optional(),
  brandOrganicToggle: z.boolean().optional(),
  brandContentToggle: z.boolean().optional(),
});

// ── Instagram ─────────────────────────────────────────────────────

export const instagramPostTypes = ['feed', 'reel', 'story'] as const;

export const instagramSettingsSchema = z.object({
  __type: z.literal('instagram'),
  postType: z.enum(instagramPostTypes).optional(),
  collaborators: z.array(z.string().trim().min(1).max(60)).max(3).optional(),
  altText: z.array(z.string().trim().max(1000)).max(10).optional(),
});

// ── X ─────────────────────────────────────────────────────────────

export const xSettingsSchema = z.object({
  __type: z.literal('x'),
  replySettings: z.enum(['mentionedUsers', 'following', 'subscribers', 'verified']).optional(),
});

// ── Discriminated union ───────────────────────────────────────────

export const postSettingsSchema = z.discriminatedUnion('__type', [
  tiktokSettingsSchema,
  instagramSettingsSchema,
  xSettingsSchema,
]);

export type TikTokSettings = z.infer<typeof tiktokSettingsSchema>;
export type InstagramSettings = z.infer<typeof instagramSettingsSchema>;
export type XSettings = z.infer<typeof xSettingsSchema>;
export type PostSettings = z.infer<typeof postSettingsSchema>;
export type PostSettingsByChannel = Partial<Record<string, PostSettings>>;

/**
 * Read settings for one target from the new per-channel map, falling back to
 * the legacy single settings object. Keeping the compatibility rule here
 * prevents adapters, workers, and route handlers from implementing subtly
 * different migrations.
 */
export function getPostSettingsForChannel(
  post: { settingsByChannel?: unknown; settings?: unknown },
  channel: string,
): PostSettings | undefined {
  const map = post.settingsByChannel;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const candidate = (map as Record<string, unknown>)[channel];
    const parsed = postSettingsSchema.safeParse(candidate);
    if (parsed.success && parsed.data.__type === channel) return parsed.data;
  }

  const legacy = postSettingsSchema.safeParse(post.settings);
  if (legacy.success && legacy.data.__type === channel) return legacy.data;
  return undefined;
}

/** Validate a sparse persisted settings map at API boundaries. */
export function assertSettingsMapMatchesChannels(
  settingsByChannel: PostSettingsByChannel | undefined,
): void {
  if (!settingsByChannel) return;
  for (const [channel, settings] of Object.entries(settingsByChannel)) {
    assertSettingsMatchesChannel(channel, settings);
  }
}

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

export function asXSettings(settings: unknown): XSettings | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const parsed = xSettingsSchema.safeParse(settings);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Does this settings object opt into TikTok Direct Post?
 *
 * The two TikTok flows end in different places — Direct Post lands on the
 * creator's profile, the inbox hand-off lands in their TikTok app waiting for
 * them to finish it — so status reporting, notifications, and delivery mode
 * all have to branch on this rather than on the channel alone.
 */
export function isTikTokDirectPostSettings(settings: unknown): boolean {
  return asTikTokSettings(settings)?.postMode === 'direct_post';
}

/** `isTikTokDirectPostSettings` for a persisted post document. */
export function isTikTokDirectPost(
  post: { settingsByChannel?: unknown; settings?: unknown } | Record<string, unknown>,
): boolean {
  return isTikTokDirectPostSettings(getPostSettingsForChannel(post, 'tiktok'));
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
