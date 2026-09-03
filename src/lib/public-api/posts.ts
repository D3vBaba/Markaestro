import { adminDb } from '@/lib/firebase-admin';
import type { SocialChannel } from '@/lib/schemas';
import type { PublicApiContext } from './auth';
import { resolveMediaAssetUrls, type ResolvedPublicMediaAsset } from './media';
import type { PublicDeliveryMode } from './scopes';
import { resolvePublicPostDestination, type ResolvedPublicDestination } from './products';
import { assertSettingsMatchesChannel, isTikTokDirectPostSettings, type PostSettings } from './post-settings';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';
import { isManualReminderDeliveryMode, MANUAL_REMINDER_DELIVERY_MODE } from '@/lib/manual-publish-flow';
import { ApiValidationError } from '@/lib/api-response';
import { assertPostMutable } from '@/lib/social/post-mutation-guards';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { checkAndIncrementUsage, refundUsage } from '@/lib/usage';
import { logger } from '@/lib/logger';
import { getSocialPostPreflightIssues } from '@/lib/social/post-preflight';
import { validateSocialPost } from '@/lib/social/post-validation';

export type PublicPostTarget = {
  channel: SocialChannel;
  destinationId?: string;
  deliveryMode?: PublicDeliveryMode;
  settings?: PostSettings;
};

type CreatePublicPostInput = {
  /** Single-target shorthand. Mutually exclusive with `targets`. */
  channel?: SocialChannel;
  /** Multi-target form. Mutually exclusive with `channel`. */
  targets?: PublicPostTarget[];
  caption: string;
  mediaAssetIds: string[];
  scheduledAt?: string | null;
  productId?: string;
  destinationId?: string;
  deliveryMode?: PublicDeliveryMode;
  settings?: PostSettings;
};

/**
 * Collapse the two accepted request shapes into the one the rest of this file
 * works in. `channel` is the shorthand for a single target and stays the
 * documented default; `targets` is the general form. Doing this once, here,
 * is what keeps every downstream rule from having to know about both.
 */
export function normalizePublicPostTargets(input: CreatePublicPostInput): PublicPostTarget[] {
  if (input.targets?.length) return input.targets;
  if (!input.channel) throw new Error('VALIDATION_CHANNEL_REQUIRED');
  return [{
    channel: input.channel,
    destinationId: input.destinationId,
    deliveryMode: input.deliveryMode,
    settings: input.settings,
  }];
}

// Meta + TikTok posts created through the public API default to manual
// reminder: the server never calls those platform APIs unless the client
// explicitly opts into direct publishing per post.
const MANUAL_REMINDER_DEFAULT_CHANNELS = new Set<SocialChannel>(['facebook', 'instagram', 'tiktok']);

export function getDeliveryModeForChannel(channel: SocialChannel): PublicDeliveryMode {
  if (MANUAL_REMINDER_DEFAULT_CHANNELS.has(channel)) return MANUAL_REMINDER_DELIVERY_MODE;
  return 'direct_publish';
}

export function resolveRequestedDeliveryMode(
  channel: SocialChannel,
  requested?: PublicDeliveryMode,
  settings?: PostSettings,
): PublicDeliveryMode {
  if (!requested) return getDeliveryModeForChannel(channel);
  if (requested === 'platform_inbox' && channel !== 'tiktok') {
    throw new Error('VALIDATION_DELIVERY_MODE_NOT_SUPPORTED_FOR_CHANNEL');
  }
  // TikTok has two API-publishing paths. Direct Post (`settings.postMode`)
  // genuinely publishes to the profile, so it keeps `direct_publish`; without
  // it the only path is the inbox hand-off, which an explicit direct-publish
  // opt-in maps onto.
  if (requested === 'direct_publish' && channel === 'tiktok') {
    return isTikTokDirectPostSettings(settings) ? 'direct_publish' : 'platform_inbox';
  }
  return requested;
}

/**
 * Channels whose public-API default is a manual reminder, and which therefore
 * cannot be scheduled without the client saying what scheduling should mean.
 *
 * A scheduled manual reminder is coherent (it becomes a timed nudge in the To
 * Post queue) but it is almost certainly not what a client sending
 * `scheduledAt` expects, and guessing wrong is silent either way. Demanding an
 * explicit `deliveryMode` turns the ambiguity into a question the client
 * answers once.
 */
const SCHEDULE_REQUIRES_EXPLICIT_DELIVERY_MODE = MANUAL_REMINDER_DEFAULT_CHANNELS;

export function assertSchedulableDeliveryMode(input: {
  channel: SocialChannel;
  scheduledAt?: string | null;
  deliveryMode?: PublicDeliveryMode;
}) {
  if (!input.scheduledAt) return;
  if (input.deliveryMode) return;
  if (!SCHEDULE_REQUIRES_EXPLICIT_DELIVERY_MODE.has(input.channel)) return;
  throw new ApiValidationError(
    'VALIDATION_SCHEDULED_DELIVERY_MODE_REQUIRED',
    `Scheduling a ${getSocialChannelConfig(input.channel)?.label ?? input.channel} post needs an explicit deliveryMode. Send "direct_publish" to publish it at the scheduled time, or "manual_reminder" to be reminded to post it yourself.`,
    { field: 'deliveryMode', channel: input.channel },
  );
}

/**
 * Normalize a requested schedule into the shape the post document stores.
 *
 * `scheduledAt` used to be validated by the schema, discarded here, and echoed
 * back as null: the one behaviour that cannot be debugged from outside, since
 * the request looked accepted. The Connect surface already scheduled properly,
 * so the two were describing different products through one wire format.
 */
export function getPublicPostInitialState(scheduledAt?: string | null) {
  if (!scheduledAt) return { status: 'draft' as const, scheduledAt: null };
  const timestamp = Date.parse(scheduledAt);
  if (!Number.isFinite(timestamp)) throw new Error('VALIDATION_INVALID_SCHEDULED_AT');
  return { status: 'scheduled' as const, scheduledAt: new Date(timestamp).toISOString() };
}

/**
 * Tell the worker a workspace has become due.
 *
 * Best-effort on purpose: the compatibility sweep finds a post whose marker
 * never landed, so a failure here delays a scheduled post rather than losing
 * it, and failing the create over it would be the worse trade.
 */
export async function markPublicPostScheduled(workspaceId: string, scheduledAt: string) {
  await markWorkspaceDue(workspaceId, scheduledAt, 'scheduled_post').catch((error: unknown) => {
    logger.warn('scheduled post due marker failed; compatibility sweep will recover it', {
      event: 'worker.mark_due_failed',
      workspaceId,
      err: error,
    });
  });
}

/**
 * The per-channel media ceiling is the narrowest of several limits a request
 * passes through (the schema allows 35, Connect allows 35, Instagram allows
 * 10), so a caller that trips it needs to be told which channel objected and
 * to what number. Shared with the Connect surface so both report it the same
 * way.
 */
export function tooManyMediaAssetsError(
  channel: string,
  channelLabel: string,
  limit: number,
  received: number,
): ApiValidationError {
  return new ApiValidationError(
    'VALIDATION_TOO_MANY_MEDIA_ASSETS',
    `${channelLabel} allows a maximum of ${limit} media items per post. This post has ${received}.`,
    { field: 'mediaAssetIds', channel, limit, received },
  );
}

export type PublicPostTargetIssue = {
  channel: SocialChannel;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

function issue(
  channel: SocialChannel,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): PublicPostTargetIssue {
  return { channel, code, message, ...(details ? { details } : {}) };
}

/**
 * Every content rule for one channel, as a list rather than a throw.
 *
 * The single-channel version stopped at the first problem, which is fine when
 * there is one channel and wrong the moment there are several: a caller
 * posting to Instagram and Pinterest wants both objections at once, not one
 * per round trip. Returning issues also gives 4.7's per-channel publish the
 * shape it needs, and it is what lets a partly-valid multi-target post report
 * precisely which target it could not accept.
 */
export function collectPublicPostTargetIssues(input: {
  channel: SocialChannel;
  caption: string;
  mediaAssetIds: string[];
}): PublicPostTargetIssue[] {
  const issues: PublicPostTargetIssue[] = [];
  const count = input.mediaAssetIds.length;
  const config = getSocialChannelConfig(input.channel);
  const label = config?.label ?? input.channel;

  if (config && count > config.maxMediaItems) {
    issues.push(issue(
      input.channel,
      'VALIDATION_TOO_MANY_MEDIA_ASSETS',
      `${label} allows a maximum of ${config.maxMediaItems} media items per post. This post has ${count}.`,
      { field: 'mediaAssetIds', limit: config.maxMediaItems, received: count },
    ));
  }

  if (config?.mediaRequired && count < 1) {
    issues.push(issue(
      input.channel,
      `VALIDATION_${input.channel.toUpperCase()}_REQUIRES_MEDIA`,
      `${label} posts need at least one image or video.`,
    ));
  }

  const maxLength = config?.maxLength ?? 65000;
  if (input.caption.length > maxLength) {
    issues.push(issue(
      input.channel,
      `VALIDATION_${input.channel.toUpperCase()}_CAPTION_TOO_LONG`,
      `${label} allows a maximum of ${maxLength} caption characters. This post has ${input.caption.length}.`,
      { field: 'caption', limit: maxLength, received: input.caption.length },
    ));
  }

  switch (input.channel) {
    case 'facebook':
      if (!input.caption && count === 0) {
        issues.push(issue(
          input.channel,
          'VALIDATION_FACEBOOK_POST_REQUIRES_CONTENT_OR_MEDIA',
          'A Facebook post needs a caption, media, or both.',
        ));
      }
      break;
    case 'linkedin':
      if (!input.caption.trim()) {
        issues.push(issue(
          input.channel,
          'VALIDATION_LINKEDIN_POST_REQUIRES_CONTENT',
          'A LinkedIn post needs a caption.',
        ));
      }
      break;
  }

  return issues;
}

/**
 * Media rules that need the resolved asset types, per channel.
 *
 * Delegates to `validateSocialPost`, the one rule set both surfaces share
 * (4.6), passing the resolved asset types so nothing is guessed from a URL.
 * Only the media-shape family is taken from the result: the payload-level
 * rules (counts, caption length, media required) already ran in
 * `collectPublicPostTargetIssues` under this surface's own error codes, and
 * repeating them here would double-report every violation.
 */
const RESOLVED_MEDIA_RULE_PATTERN =
  /_VIDEO_NOT_SUPPORTED$|_IMAGE_NOT_SUPPORTED$|_MAX_ONE_VIDEO$|_VIDEO_CANNOT_BE_COMBINED$|_VIDEO_MUST_BE_SINGLE_MEDIA$|_MEDIA_INVALID$/;

export function collectResolvedPublicPostTargetIssues(
  channel: SocialChannel,
  mediaAssets: ResolvedPublicMediaAsset[],
): PublicPostTargetIssue[] {
  const shared = validateSocialPost({
    channel,
    mediaUrls: mediaAssets.map((asset) => asset.url),
    mediaTypes: mediaAssets.map((asset) => asset.type),
    // Caption rules run in the payload stage; a non-empty placeholder keeps
    // the LinkedIn content rule from double-firing here.
    content: 'resolved-stage',
  });

  return shared
    .filter((entry) => RESOLVED_MEDIA_RULE_PATTERN.test(entry.code))
    .map((entry) => issue(channel, entry.code, entry.message));
}

/**
 * Raise a target issue list as one error.
 *
 * A single-target request keeps its original single-code error, because a
 * generation of clients branches on `error` being exactly
 * `VALIDATION_TIKTOK_MAX_ONE_VIDEO` and turning that into `VALIDATION_ERROR`
 * would break them for no gain. Multi-target requests get the list, since
 * there is no single code that could describe two channels failing for two
 * different reasons.
 */
export function raisePublicPostTargetIssues(
  issues: PublicPostTargetIssue[],
  singleTarget: boolean,
): never {
  const first = issues[0];
  if (singleTarget) {
    throw new ApiValidationError(first.code, first.message, {
      channel: first.channel,
      ...(first.details ?? {}),
    });
  }
  throw new ApiValidationError(
    'VALIDATION_ERROR',
    issues.map((entry) => entry.message).join(' '),
    { issues },
  );
}

/** Back-compat wrapper: one channel, first issue thrown. */
export function validatePublicPostInput(input: {
  channel: SocialChannel;
  caption: string;
  mediaAssetIds: string[];
}) {
  const issues = collectPublicPostTargetIssues(input);
  if (issues.length > 0) raisePublicPostTargetIssues(issues, true);
}

/** Back-compat wrapper: one channel, first resolved-media issue thrown. */
export function validateResolvedPublicPostInput(
  input: { channel: SocialChannel; caption?: string; mediaAssetIds?: string[] },
  mediaAssets: ResolvedPublicMediaAsset[],
) {
  const issues = collectResolvedPublicPostTargetIssues(input.channel, mediaAssets);
  if (issues.length > 0) raisePublicPostTargetIssues(issues, true);
}

export async function assertPublicPostSchedulable(
  workspaceId: string,
  input: {
    channels: SocialChannel[];
    manualChannels: SocialChannel[];
    caption: string;
    mediaUrls: string[];
    productId?: string;
    channelDestinations?: Partial<Record<SocialChannel, string>>;
  },
) {
  const autoChannels = input.channels.filter((channel) => !input.manualChannels.includes(channel));
  const issues = await getSocialPostPreflightIssues(
    workspaceId,
    input.productId,
    {
      content: input.caption,
      channel: input.channels[0],
      targetChannels: input.channels,
      mediaUrls: input.mediaUrls,
    },
    {
      // Manual targets never contact the platform, so requiring a ready
      // connection for one would refuse a post that is perfectly fine.
      requireReadyChannels: autoChannels.length > 0,
      manualChannels: input.manualChannels,
      ...(input.channelDestinations ? { channelDestinations: input.channelDestinations } : {}),
    },
  );
  if (issues.length === 0) return;
  throw new ApiValidationError(
    'VALIDATION_ERROR',
    issues.map((entry) => entry.message).join(' '),
    { issues },
  );
}

/**
 * Resolve one target's destination.
 *
 * Manual reminder targets don't need a connected platform account, because
 * nothing is ever sent to the platform. Resolve best-effort so the post still
 * attaches to the right brand and account when one is connected, but treat
 * "no destination configured" as fine rather than an error.
 */
async function resolveTargetDestination(
  workspaceId: string,
  target: PublicPostTarget,
  productId: string | undefined,
  manual: boolean,
): Promise<ResolvedPublicDestination | null> {
  const resolve = () => resolvePublicPostDestination(
    workspaceId,
    target.channel,
    productId,
    target.destinationId,
  );
  if (!manual) return resolve();
  return resolve().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    const missingDestination =
      message.startsWith('VALIDATION_DESTINATION') ||
      message.startsWith('VALIDATION_PRODUCT_ID_REQUIRED');
    if (!missingDestination) throw error;
    return null;
  });
}

function resolveTargetSettings(targets: PublicPostTarget[]) {
  const settingsByChannel: Partial<Record<SocialChannel, PostSettings>> = {};
  for (const target of targets) {
    if (target.settings) settingsByChannel[target.channel] = target.settings;
  }
  return {
    settingsByChannel,
    // The primary target remains mirrored for older clients and records.
    settings: targets[0]?.settings,
  };
}

export async function createPublicPost(ctx: PublicApiContext, input: CreatePublicPostInput) {
  const targets = normalizePublicPostTargets(input);
  const singleTarget = targets.length === 1;

  // Every target is validated, then every issue is reported at once. Stopping
  // at the first one made a two-channel post a two-round-trip conversation.
  const issues = targets.flatMap((target) => collectPublicPostTargetIssues({
    channel: target.channel,
    caption: input.caption,
    mediaAssetIds: input.mediaAssetIds,
  }));
  if (issues.length > 0) raisePublicPostTargetIssues(issues, singleTarget);

  for (const target of targets) {
    assertSettingsMatchesChannel(target.channel, target.settings);
    assertSchedulableDeliveryMode({
      channel: target.channel,
      scheduledAt: input.scheduledAt,
      deliveryMode: target.deliveryMode,
    });
  }
  const { settings, settingsByChannel } = resolveTargetSettings(targets);

  // Product-bound keys force their own product: a missing productId defaults to
  // it, and an explicit productId for any other product is rejected.
  let productId = input.productId;
  if (ctx.productId) {
    if (productId && productId !== ctx.productId) {
      throw new Error('VALIDATION_PRODUCT_SCOPE_MISMATCH');
    }
    productId = ctx.productId;
  }

  const mediaAssets = await resolveMediaAssetUrls(ctx.workspaceId, input.mediaAssetIds);
  const resolvedIssues = targets.flatMap((target) =>
    collectResolvedPublicPostTargetIssues(target.channel, mediaAssets));
  if (resolvedIssues.length > 0) raisePublicPostTargetIssues(resolvedIssues, singleTarget);

  const resolved = await Promise.all(targets.map(async (target) => {
    const deliveryMode = resolveRequestedDeliveryMode(
      target.channel,
      target.deliveryMode,
      target.settings,
    );
    const manual = isManualReminderDeliveryMode(deliveryMode);
    // A test key must work before any real account is connected, so a missing
    // destination is tolerated the way it is for manual posts: the sandbox
    // adapter needs no connection at publish time.
    const destination = await resolveTargetDestination(
      ctx.workspaceId,
      target,
      productId,
      manual || ctx.mode === 'test',
    );
    return {
      target,
      deliveryMode: manual ? deliveryMode : destination?.deliveryMode || deliveryMode,
      manual,
      destination,
    };
  }));

  // The first target is the primary: it fills the single-channel fields every
  // existing reader (the composer, the metrics poller, older API clients)
  // still expects, while `targetChannels` carries the full set.
  const primary = resolved[0];
  const channelDestinations: Partial<Record<SocialChannel, string>> = {};
  const channelDeliveryModes: Partial<Record<SocialChannel, string>> = {};
  for (const entry of resolved) {
    const destinationId = entry.destination?.destinationId;
    if (destinationId) channelDestinations[entry.target.channel] = destinationId;
    channelDeliveryModes[entry.target.channel] = entry.deliveryMode;
  }

  // Draft-first unless the client asked for a schedule. A draft waits for a
  // user or an explicit publish call; a scheduled post is a promise the worker
  // will keep, which is why it has to pass preflight here rather than fail
  // silently at publish time with no way for the client to have known.
  const initialState = getPublicPostInitialState(input.scheduledAt);
  if (initialState.status === 'scheduled') {
    await assertPublicPostSchedulable(ctx.workspaceId, {
      channels: resolved.map((entry) => entry.target.channel),
      manualChannels: resolved.filter((entry) => entry.manual).map((entry) => entry.target.channel),
      caption: input.caption,
      mediaUrls: mediaAssets.map((asset) => asset.url),
      productId: primary.destination?.productId || productId || undefined,
      channelDestinations,
    });
  }

  // Metered like the app's create path (4.8). Currently a formality on paid
  // tiers (postsPerMonth is unlimited there), but the counters must not
  // under-report actual creation, and the day a tier gets a post cap this
  // surface must not be the way around it. Reserve-and-refund, per post, so a
  // failed create gives the slot back. `ownerUid` can be absent on old keys;
  // the helper falls back to workspace-scoped metering.
  const quota = await checkAndIncrementUsage(ctx.ownerUid ?? '', 'posts', ctx.workspaceId);
  if (!quota.allowed) {
    throw new Error('QUOTA_EXCEEDED_POSTS');
  }
  const reservedPostQuota = quota.limit !== -1;

  const now = new Date().toISOString();
  const ref = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`).doc();
  const payload = {
    content: input.caption,
    channel: primary.target.channel,
    targetChannels: resolved.map((entry) => entry.target.channel),
    channelDestinations,
    channelDeliveryModes,
    status: initialState.status,
    scheduledAt: initialState.scheduledAt,
    // Kept alongside `scheduledAt` so a later reschedule can still report what
    // the client originally asked for, matching what the Connect surface and
    // the app both write.
    originalScheduledAt: initialState.scheduledAt,
    mediaUrls: mediaAssets.map((asset) => asset.url),
    mediaAssetIds: input.mediaAssetIds,
    productId: primary.destination?.productId || productId || '',
    destinationId: primary.destination?.destinationId || '',
    destinationProvider: primary.destination?.destinationProvider || '',
    deliveryMode: primary.deliveryMode,
    willAlsoPublishTo: primary.destination?.willAlsoPublishTo ?? [],
    settings: settings ?? null,
    settingsByChannel,
    workspaceId: ctx.workspaceId,
    // Tagged so the publisher routes to the sandbox and analytics can drop it
    // (5.7). Absent on live posts rather than false, so the field is greppable
    // and the analytics filter's `!== true` reads existing documents cheaply.
    ...(ctx.mode === 'test' ? { testMode: true } : {}),
    createdBy: ctx.ownerUid ?? ctx.clientId,
    createdByType: ctx.principalType,
    createdById: ctx.clientId,
    createdAt: now,
    updatedAt: now,
    externalId: '',
    externalUrl: '',
    errorMessage: '',
    publishResults: [],
  };

  try {
    await ref.set(payload);
  } catch (error) {
    if (reservedPostQuota) {
      await refundUsage(ctx.ownerUid ?? '', 'posts', 1, ctx.workspaceId).catch(() => undefined);
    }
    throw error;
  }
  if (initialState.scheduledAt) {
    await markPublicPostScheduled(ctx.workspaceId, initialState.scheduledAt);
  }
  return { id: ref.id, ...payload };
}

export async function getPublicPost(workspaceId: string, postId: string): Promise<{ id: string } & Record<string, unknown>> {
  const snap = await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) };
}

/**
 * Resolve which brand (productId) a list query should be scoped to.
 *
 * A brand-bound key is hard-scoped to its own brand: it may omit the filter or
 * name its own brand, but asking for another brand is forbidden. An unbound
 * workspace key may filter by any brand, or omit it to list every brand.
 */
export function resolvePublicPostBrandScope(
  keyProductId?: string,
  requestedProductId?: string,
): string | undefined {
  if (!keyProductId) return requestedProductId || undefined;
  if (requestedProductId && requestedProductId !== keyProductId) {
    throw new Error('FORBIDDEN');
  }
  return keyProductId;
}

/**
 * A brand-bound key must not read or mutate another brand's post. Reported as
 * NOT_FOUND rather than FORBIDDEN so a key cannot probe for post ids that
 * exist outside its brand.
 */
export function assertPublicPostInBrandScope(
  post: Record<string, unknown>,
  keyProductId?: string,
) {
  if (!keyProductId) return;
  if (post.productId !== keyProductId) throw new Error('NOT_FOUND');
}

/**
 * A post already handed to the publisher must not be deleted out from under
 * it: the run would keep going and could publish, leaving a live post with
 * no record. Callers should cancel or wait for it to settle first.
 *
 * Delegates to the shared guard so this surface and `/api/posts/[id]` apply
 * the same rule, including honouring an expired publish lease.
 */
export function assertPublicPostDeletable(post: Record<string, unknown>) {
  assertPostMutable(post, 'delete');
}

export async function deletePublicPost(workspaceId: string, postId: string) {
  await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).delete();
}

/**
 * The channels a post targets, as the wire shape a client sent or would send.
 *
 * Derived from the stored per-channel maps rather than stored separately, so
 * a post written before `targets` existed still reports one, and a post the
 * app created multi-channel reads back through this surface the same way a
 * multi-target API create does.
 */
function serializePublicPostTargets(post: Record<string, unknown>) {
  const stored = Array.isArray(post.targetChannels) ? post.targetChannels : [];
  const channels = (stored.length > 0 ? stored : [post.channel])
    .filter((channel): channel is string => typeof channel === 'string' && channel.length > 0);
  const destinations = (post.channelDestinations ?? {}) as Record<string, unknown>;
  const modes = (post.channelDeliveryModes ?? {}) as Record<string, unknown>;
  const settingsByChannel = (post.settingsByChannel ?? {}) as Record<string, unknown>;
  return channels.map((channel, index) => {
    const settings = settingsByChannel[channel]
      ?? (index === 0 ? post.settings : undefined);
    return {
      channel,
      destinationId: typeof destinations[channel] === 'string'
        ? destinations[channel]
        // The primary target's destination lives in the top-level field on
        // every post written before the per-channel map existed.
        : index === 0 ? String(post.destinationId || '') : '',
      deliveryMode: typeof modes[channel] === 'string'
        ? modes[channel]
        : index === 0 ? String(post.deliveryMode || '') : '',
      ...(settings != null ? { settings } : {}),
    };
  });
}

export function serializePublicPost(post: Record<string, unknown>) {
  return {
    id: String(post.id),
    channel: post.channel,
    targets: serializePublicPostTargets(post),
    status: post.status,
    caption: post.content || '',
    productId: post.productId || '',
    destinationId: post.destinationId || '',
    destinationProvider: post.destinationProvider || '',
    deliveryMode: post.deliveryMode || '',
    settings: post.settings ?? null,
    settingsByChannel: post.settingsByChannel ?? {},
    mediaAssetIds: Array.isArray(post.mediaAssetIds) ? post.mediaAssetIds : [],
    mediaUrls: Array.isArray(post.mediaUrls) ? post.mediaUrls : [],
    scheduledAt: post.scheduledAt ?? null,
    // Clients need to know when a post actually went live, not just that its
    // status says so. `post-ordering.ts` already treats this as the canonical
    // publish timestamp.
    publishedAt: typeof post.publishedAt === 'string' ? post.publishedAt : null,
    externalId: post.externalId || '',
    externalUrl: post.externalUrl || '',
    publishResults: Array.isArray(post.publishResults) ? post.publishResults : [],
    nextAction: post.nextAction || '',
    sourceType: post.sourceType || '',
    slideshowId: post.slideshowId || '',
    slideshowTitle: post.slideshowTitle || '',
    slideshowSlideCount: typeof post.slideshowSlideCount === 'number' ? post.slideshowSlideCount : null,
    slideshowCoverIndex: typeof post.slideshowCoverIndex === 'number' ? post.slideshowCoverIndex : null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

/**
 * The wire shape of a post in the public API. Derived from the serializer
 * rather than declared alongside it, so the two cannot drift: a field added
 * to `serializePublicPost` appears here, and one removed disappears.
 */
export type PublicPostResponse = ReturnType<typeof serializePublicPost>;
