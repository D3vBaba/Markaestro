/**
 * The catalogue of error codes the API can return.
 *
 * Before this existed the codes were spread across an if-chain in
 * `apiError()`, a regex in `user-facing-errors.ts`, and a hand-maintained
 * markdown table, and several were built at runtime from a channel name
 * (`VALIDATION_INSTAGRAM_CONTENT_TOO_LONG`). None of those three lists could
 * be enumerated, which meant an integrator could not find out what they might
 * receive and the OpenAPI spec could not document error responses at all.
 *
 * This file is the single list. `apiError()` maps from it, the generator in
 * `scripts/generate-openapi.mjs` reads it through `listErrorCodes()`, and the
 * channel-specific codes are generated from the same templates that build them
 * at runtime rather than being written out six times each.
 *
 * Adding a code here is what makes it documented. A code thrown without an
 * entry still works (it falls through to the status rules at the bottom of
 * `resolveErrorCode`), it is simply invisible to the docs, which is the state
 * every code was in before.
 */

import { socialChannels } from '@/lib/schemas';

export type ErrorCategory =
  | 'auth'
  | 'permission'
  | 'validation'
  | 'quota'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'server';

export type ErrorCodeSpec = {
  /** HTTP status this code is returned with. */
  status: number;
  /**
   * Whether an identical retry can plausibly succeed. `false` means the caller
   * must change something first, which is what an SDK needs to know before it
   * decides to back off or give up.
   */
  retryable: boolean;
  category: ErrorCategory;
  /** One line for the reference documentation. Not user-facing copy. */
  description: string;
  /**
   * Copy the application owns, safe to render verbatim. Present only where we
   * have written the sentence; codes whose explanation depends on runtime
   * facts carry their copy on the response instead (see `authoredError`).
   */
  userMessage?: string;
};

/**
 * Codes whose meaning does not depend on a channel or a runtime value.
 *
 * Ordered by status so the table reads the way the documentation renders it.
 */
export const ERROR_CODES: Record<string, ErrorCodeSpec> = {
  VALIDATION_EVERGREEN_SOURCE_NO_CAPTION: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The Evergreen source post has no caption to rewrite.',
    userMessage: 'This post has no caption, so there is nothing to rewrite.',
  },
  VALIDATION_EVERGREEN_RUN_NOT_REVIEWABLE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The Evergreen run is not waiting for review.',
    userMessage: 'This occurrence is no longer waiting for review.',
  },
  VALIDATION_EVERGREEN_ARCHIVED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'An archived Evergreen queue cannot be edited, activated, or resumed.',
  },
  VALIDATION_EVERGREEN_CHANNEL_NOT_IN_SOURCE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The queue targets a channel that was not part of the proven source post.',
  },
  VALIDATION_EVERGREEN_INTERVAL_TOO_SHORT: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The requested Evergreen interval is below the allowed minimum for one or more channels.',
  },
  VALIDATION_EVERGREEN_SOURCE_BRAND_MISMATCH: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The source post belongs to a different brand than the Evergreen queue.',
  },
  EVERGREEN_SOURCE_NOT_PUBLISHED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The Evergreen source post is no longer in the published state.',
  },
  EVERGREEN_SOURCE_INELIGIBLE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The source post is not published, mature, measured, or otherwise eligible for an Evergreen queue.',
    userMessage: 'This post does not have enough mature performance data for an Evergreen queue yet.',
  },
  EVERGREEN_UPGRADE_REQUIRED: {
    status: 403,
    retryable: false,
    category: 'permission',
    description: 'The workspace plan does not include active Evergreen queues.',
    userMessage: 'Upgrade to Pro or Business to activate Intelligent Evergreen.',
  },
  EVERGREEN_QUEUE_LIMIT_REACHED: {
    status: 409,
    retryable: false,
    category: 'quota',
    description: 'The brand has reached its active Evergreen queue limit.',
    userMessage: 'This brand has reached its active Evergreen queue limit.',
  },
  CHANNEL_BILLING_ACTION_REQUIRED: {
    status: 402,
    retryable: false,
    category: 'quota',
    description: 'The workspace reached the configured provider spending limit for this channel.',
    userMessage: 'This channel has reached its workspace spending limit. Review its billing settings before publishing again.',
  },
  EVERGREEN_SOURCE_MISSING: {
    status: 404,
    retryable: false,
    category: 'not_found',
    description: 'The source post for this Evergreen queue no longer exists.',
  },
  CONFLICT: {
    status: 409,
    retryable: false,
    category: 'conflict',
    description: 'The resource changed after the caller read it. Fetch the latest version before updating it.',
  },
  VALIDATION_ERROR: {
    status: 400,
    retryable: false,
    category: 'validation',
    description:
      'The request body failed schema validation. The `issues` array names each field and what was wrong with it.',
  },
  INVALID_PROVIDER: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The OAuth provider in the path is not one this deployment supports.',
  },
  INVALID_STATE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The OAuth state parameter was missing or malformed.',
  },
  STATE_EXPIRED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The OAuth state parameter has expired. Start the connection flow again.',
  },
  STATE_MISMATCH: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The OAuth state parameter did not match the one issued for this flow.',
  },
  OTP_INVALID: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The sign-in code was not correct.',
  },
  OTP_EXPIRED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The sign-in code has expired. Request a new one.',
  },
  OTP_TOO_MANY_ATTEMPTS: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'Too many incorrect sign-in codes were entered. Request a new code.',
  },
  VALIDATION_IDEMPOTENCY_KEY_INVALID: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The `Idempotency-Key` header was present but not a usable key.',
  },
  VALIDATION_IDEMPOTENCY_KEY_REUSED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description:
      'The `Idempotency-Key` was already used with a different request body. Use a new key for a different request.',
  },
  VALIDATION_INVALID_CURSOR: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The pagination cursor was not one this endpoint issued.',
  },
  VALIDATION_TOO_MANY_MEDIA_ASSETS: {
    status: 400,
    retryable: false,
    category: 'validation',
    description:
      'The post carries more media items than the target channel allows. The response names the channel, the limit, and the count received.',
  },
  VALIDATION_PRODUCT_SCOPE_MISMATCH: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The request named a brand other than the one this API key is bound to.',
  },
  VALIDATION_PRODUCT_REQUIRED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'This operation needs a brand and none was supplied or inferable.',
  },
  VALIDATION_DELIVERY_MODE_NOT_SUPPORTED_FOR_CHANNEL: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The requested delivery mode is not available on this channel.',
  },
  VALIDATION_DESTINATION_ID_REQUIRED_FOR_CHANNEL: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'This channel has more than one connected destination, so one must be named explicitly.',
  },
  VALIDATION_DESTINATION_NOT_CONFIGURED_FOR_CHANNEL: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'No account is connected for this channel.',
  },
  VALIDATION_DESTINATION_NOT_CONFIGURED_FOR_PRODUCT: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'No account is connected for this channel on the named brand.',
  },
  VALIDATION_INVALID_DESTINATION: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The named destination does not belong to this brand and channel.',
  },
  VALIDATION_SETTINGS_CHANNEL_MISMATCH: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The `settings` object is for a different channel than the post targets.',
  },
  VALIDATION_POST_NOT_PUBLISHABLE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The post is in a status that cannot be published from.',
  },
  VALIDATION_POST_ALREADY_PUBLISHING: {
    status: 400,
    retryable: true,
    category: 'validation',
    description: 'A publish run for this post is already in flight. Wait for it to settle.',
  },
  VALIDATION_POST_IS_PUBLISHING: {
    status: 400,
    retryable: true,
    category: 'validation',
    description:
      'The post is being published right now and cannot be edited or deleted until the run settles.',
  },
  VALIDATION_MEDIA_IN_USE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description:
      'The media asset is attached to a scheduled or publishing post. The response names how many.',
  },
  VALIDATION_INVALID_FILE_TYPE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The uploaded file type is not one the media library accepts.',
  },
  VALIDATION_FILE_TOO_LARGE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The uploaded file exceeds the size cap for its type.',
  },
  VALIDATION_NO_FILE_PROVIDED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The upload request carried no file.',
  },
  VALIDATION_INVALID_UPLOAD_SESSION: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The upload session is unknown, already finalized, or expired.',
  },
  VALIDATION_UPLOAD_METADATA_MISMATCH: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The finalized object does not match the metadata the upload session reserved.',
  },
  VALIDATION_UPLOAD_CONTENT_TYPE_MISMATCH: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The uploaded object content type differs from the one declared in the session.',
  },
  VALIDATION_WEBHOOK_URL_MUST_BE_HTTPS: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'Webhook endpoints must use https.',
  },
  VALIDATION_WEBHOOK_URL_NOT_ALLOWED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description:
      'The webhook URL resolves to an address delivery is not permitted to reach (loopback, link-local, or private range).',
  },
  VALIDATION_INVALID_SCHEDULED_AT: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: '`scheduledAt` was not a future ISO 8601 timestamp.',
  },
  VALIDATION_TOO_MANY_DESTINATIONS: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The request named more destinations than one call may fan out to.',
  },
  VALIDATION_WORKSPACE_MISMATCH: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The signed request named a workspace other than the one its key identifies.',
  },
  VALIDATION_UNKNOWN_API_VERSION: {
    status: 400,
    retryable: false,
    category: 'validation',
    description:
      'The `Markaestro-Version` header named a version this deployment does not serve. Unrecognised versions are refused rather than silently ignored.',
  },
  API_KEY_NOT_BOUND_TO_PRODUCT: {
    status: 403,
    retryable: false,
    category: 'permission',
    description:
      'The API key predates brand binding and cannot be used. Create a new key, which binds to exactly one brand.',
  },
  UNAUTHENTICATED: {
    status: 401,
    retryable: false,
    category: 'auth',
    description: 'No credential was presented, or the one presented is not valid.',
  },
  QUOTA_EXCEEDED: {
    status: 402,
    retryable: false,
    category: 'quota',
    description: 'The workspace has used its monthly AI operation allowance.',
  },
  VIDEO_QUOTA_EXCEEDED: {
    status: 402,
    retryable: false,
    category: 'quota',
    description: 'The workspace has used its monthly video allowance.',
  },
  QUOTA_EXCEEDED_STORAGE: {
    status: 402,
    retryable: false,
    category: 'quota',
    description:
      'The workspace has used its storage allowance. Delete unused media or upgrade the plan.',
  },
  QUOTA_EXCEEDED_POSTS: {
    status: 402,
    retryable: false,
    category: 'quota',
    description: 'The workspace has used its monthly post allowance.',
  },
  BRAND_LIMIT_REACHED: {
    status: 402,
    retryable: false,
    category: 'quota',
    description: 'The plan has reached its brand limit.',
    userMessage:
      'Your plan has reached its brand limit. Upgrade your plan or add a brand pack to create another brand.',
  },
  CHANNEL_LIMIT_REACHED: {
    status: 402,
    retryable: false,
    category: 'quota',
    description: 'The plan limits how many channels each brand may connect.',
    userMessage:
      'Your plan limits how many channels each brand can connect. Upgrade your plan or disconnect a channel to add another.',
  },
  SUBSCRIPTION_REQUIRED: {
    status: 402,
    retryable: false,
    category: 'quota',
    description: 'This operation needs an active subscription.',
  },
  TEAM_LIMIT_REACHED: {
    status: 402,
    retryable: false,
    category: 'quota',
    description: 'The plan has reached its team member limit.',
  },
  WORKSPACE_LIMIT_REACHED: {
    status: 402,
    retryable: false,
    category: 'quota',
    description: 'The account has reached its workspace limit.',
  },
  FORBIDDEN: {
    status: 403,
    retryable: false,
    category: 'permission',
    description: 'The credential is valid but lacks the scope or role this operation needs.',
  },
  FORBIDDEN_WORKSPACE: {
    status: 403,
    retryable: false,
    category: 'permission',
    description: 'The credential does not have access to the named workspace.',
  },
  EMAIL_VERIFICATION_REQUIRED: {
    status: 403,
    retryable: false,
    category: 'permission',
    description: 'The account must confirm its email address before this operation.',
  },
  USER_DISABLED: {
    status: 403,
    retryable: false,
    category: 'permission',
    description: 'The account has been disabled.',
  },
  NOT_FOUND: {
    status: 404,
    retryable: false,
    category: 'not_found',
    description:
      'The resource does not exist, or is outside the brand this API key is bound to. The two are deliberately indistinguishable.',
  },
  FEATURE_NOT_AVAILABLE: {
    status: 404,
    retryable: false,
    category: 'not_found',
    description: 'The feature is not enabled for this workspace or deployment.',
  },
  EMAIL_IN_USE: {
    status: 409,
    retryable: false,
    category: 'conflict',
    description: 'Another account already uses this email address.',
  },
  WEBHOOK_ENDPOINT_LIMIT_REACHED: {
    status: 409,
    retryable: false,
    category: 'conflict',
    description: 'The workspace has as many webhook endpoints as it may register.',
  },
  OTP_COOLDOWN: {
    status: 429,
    retryable: true,
    category: 'rate_limit',
    description: 'A sign-in code was requested too recently. Wait before requesting another.',
  },
  RATE_LIMITED: {
    status: 429,
    retryable: true,
    category: 'rate_limit',
    description:
      'The rate limit for this key or route was exceeded. `Retry-After` and the `X-RateLimit-*` headers say when to try again.',
  },
  INTERNAL_ERROR: {
    status: 500,
    retryable: true,
    category: 'server',
    description:
      'An unhandled failure. The `requestId` in the body identifies the request in the server logs.',
  },
  MALFORMED_RESPONSE: {
    status: 500,
    retryable: true,
    category: 'server',
    description:
      'Synthesised by the client when a response body will not parse (a proxy error page, a truncated body).',
  },

  // ── Added by the 5.13 sweep ────────────────────────────────────────
  // Every code the codebase throws that the first pass did not carry. The
  // statuses match what `apiError` already returned for them, deliberately:
  // cataloguing a code documents it, and a documented code that quietly
  // changed status would be a behaviour change inside a version. `retryable`
  // is new information rather than changed behaviour, which is why the model
  // backend codes are marked retryable while staying 500.

  VALIDATION_CHANNEL_REQUIRED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The request named neither `channel` nor `targets`, so there is no destination to post to.',
  },
  VALIDATION_SCHEDULED_DELIVERY_MODE_REQUIRED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'Scheduling a Facebook, Instagram, or TikTok post needs an explicit `deliveryMode`, because the channel default for those is a manual reminder and a scheduled reminder is probably not what was meant.',
  },
  VALIDATION_MULTIPLE_TARGET_SETTINGS_UNSUPPORTED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'More than one target carried platform `settings`. A post stores one settings object, so create one post per channel that needs its own.',
  },
  VALIDATION_SCHEDULED_AT_REQUIRED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The post has no scheduled time, so it cannot be moved into the scheduled state.',
  },
  VALIDATION_POST_ALREADY_PUBLISHED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The post has already gone out, so this operation would change the record without changing anything on the platform.',
  },
  VALIDATION_POST_NOT_RESCHEDULABLE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The post is in a status that cannot be rescheduled.',
  },
  VALIDATION_POST_CREATE_FAILED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'Every destination in a fan-out create failed. The `errors` array names each one.',
  },
  VALIDATION_NO_DESTINATION: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The request selected no destination accounts.',
  },
  VALIDATION_WORKSPACE_REQUIRED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The request did not resolve to a workspace.',
  },
  VALIDATION_INVALID_WORKSPACE_ID: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The workspace id was malformed.',
  },
  VALIDATION_MISSING_PRODUCT_ID: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The request needs a brand (`productId`) and did not name one.',
  },
  VALIDATION_PRODUCT_ID_REQUIRED_FOR_CHANNEL: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'This channel needs an explicit brand, because more than one is connected.',
  },
  VALIDATION_TOO_MANY_PRODUCT_IDS: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The request named more brands than this endpoint accepts.',
  },
  VALIDATION_CAPTION_TOO_LONG: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The caption exceeds the payload-size guard, which is set to the widest limit any channel allows.',
  },
  VALIDATION_IDENTIFIER_TOO_LONG: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'An identifier in the request exceeds its maximum length.',
  },
  VALIDATION_CAMPAIGN_HAS_REFERENCES: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The campaign is still referenced by tracked links or posts. Detach them before deleting it.',
  },
  VALIDATION_MISSING_PAGE_ID: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The request did not name the page to act on.',
  },
  VALIDATION_TOO_MANY_PAGES: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The request named more pages than this endpoint accepts.',
  },
  VALIDATION_MISSING_ID_TOKEN: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The sign-in request carried no ID token.',
  },
  VALIDATION_INVALID_RETURN_TO: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The return path was not a safe internal path.',
  },
  VALIDATION_CONFIRMATION_MISMATCH: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The typed confirmation did not match what was asked for.',
  },
  VALIDATION_ALREADY_OWNER: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The member named is already the workspace owner.',
  },
  VALIDATION_OWNER_CANNOT_LEAVE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The owner cannot leave a workspace. Transfer ownership first, or delete the workspace.',
  },
  VALIDATION_UPLOAD_URL_ALREADY_USED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'This direct-upload URL has already been finalized.',
  },
  VALIDATION_FILE_TOO_LARGE_10MB: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The image exceeds the 10 MB image ceiling.',
  },
  VALIDATION_FILE_TOO_LARGE_250MB: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The video exceeds the 250 MB video ceiling.',
  },
  VALIDATION_REMOTE_FILE_TOO_LARGE: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The remote file exceeds the size this endpoint will fetch.',
  },
  VALIDATION_INVALID_REMOTE_URL: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The remote URL was malformed.',
  },
  VALIDATION_REMOTE_URL_NOT_ALLOWED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The remote URL resolves somewhere outbound requests are not permitted. See the SSRF guard in `lib/network-security.ts`.',
  },
  VALIDATION_SCAN_FETCH_FAILED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The page could not be fetched for scanning.',
  },
  VALIDATION_SCAN_BLOCKED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The site answered with a bot challenge instead of its content, so nothing could be read. The site owner controls this; enter the brand details manually.',
  },
  VALIDATION_SCAN_UNSUPPORTED_CONTENT: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The fetched page was not a content type the scanner reads.',
  },
  VALIDATION_KNOWLEDGE_IMPORT_NO_URL: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The brand has no website to import knowledge from. Pass a URL or set one on the brand first.',
  },
  KNOWLEDGE_IMPORT_UNAVAILABLE: {
    status: 503,
    retryable: false,
    category: 'server',
    description: 'Website import is not configured on this deployment (Cloudflare Browser Rendering credentials are missing).',
  },
  KNOWLEDGE_IMPORT_EMPTY: {
    status: 400,
    retryable: true,
    category: 'validation',
    description: 'None of the website pages could be read. The site may block automated browsers or be temporarily down.',
  },
  VALIDATION_POST_NOT_MEASURED: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The post has no metrics yet, so there is nothing to explain.',
  },
  VALIDATION_EXPERIMENT_OBSERVATIONS: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The experiment does not have enough observations in both arms to evaluate.',
  },
  VALIDATION_INVALID_WORKER_DUE_AT: {
    status: 400,
    retryable: false,
    category: 'validation',
    description: 'The worker due timestamp was not parseable.',
  },
  VERTEX_UNAVAILABLE: {
    status: 500,
    retryable: true,
    category: 'server',
    description: 'The model backend was unavailable. The AI operation is refunded, so an identical retry is safe.',
  },
  VERTEX_AI_EMPTY_RESPONSE: {
    status: 500,
    retryable: true,
    category: 'server',
    description: 'The model returned no content. The AI operation is refunded.',
  },
  VERTEX_AI_INVALID_JSON: {
    status: 500,
    retryable: true,
    category: 'server',
    description: 'The model returned content that did not parse against the response schema. The AI operation is refunded.',
  },
  VERTEX_AI_NOT_CONFIGURED: {
    status: 500,
    retryable: false,
    category: 'server',
    description: 'This deployment has no model backend configured. An operator has to fix it; retrying will not.',
  },
  RESEND_NOT_CONFIGURED: {
    status: 500,
    retryable: false,
    category: 'server',
    description: 'This deployment has no transactional email provider configured.',
  },
  EMAIL_SEND_FAILED: {
    status: 500,
    retryable: true,
    category: 'server',
    description: 'The transactional email provider rejected the send.',
  },
  CONVERSION_INGEST_NOT_CONFIGURED: {
    status: 500,
    retryable: false,
    category: 'server',
    description: 'This deployment has no conversion ingest root secret, so per-workspace ingest keys cannot be derived.',
  },
  CONNECT_UPLOAD_SECRET_MISSING: {
    status: 500,
    retryable: false,
    category: 'server',
    description: 'This deployment has no Connect upload signing secret configured.',
  },
  MEDIA_PROXY_SECRET_MISSING: {
    status: 500,
    retryable: false,
    category: 'server',
    description: 'This deployment has no media proxy signing secret configured.',
  },
  WORKER_CLOUD_TASKS_NOT_CONFIGURED: {
    status: 500,
    retryable: false,
    category: 'server',
    description: 'This deployment has no Cloud Tasks queue configured for worker dispatch.',
  },
  GOOGLE_APPLICATION_CREDENTIALS_UNAVAILABLE: {
    status: 500,
    retryable: false,
    category: 'server',
    description: 'The runtime could not obtain Google application default credentials.',
  },
  REQUEST_TIMEOUT: {
    status: 500,
    retryable: true,
    category: 'server',
    description: 'An upstream request exceeded its deadline.',
  },
  AI_FINGERPRINT_KIND_MISMATCH: {
    status: 500,
    retryable: false,
    category: 'server',
    description: 'A cached fingerprint was read for the wrong analysis kind.',
  },
  UNKNOWN_INTELLIGENCE_JOB: {
    status: 500,
    retryable: false,
    category: 'server',
    description: 'The worker was handed an intelligence job type it does not know how to run.',
  },
  RATE_LIMITED_CHANNEL: {
    status: 429,
    retryable: true,
    category: 'rate_limit',
    description:
      'This channel has hit its hourly publish ceiling for the workspace. The response names the channel and how long to wait.',
  },
  WEBHOOK_ENDPOINT_DISABLED: {
    status: 409,
    retryable: false,
    category: 'conflict',
    description: 'The webhook endpoint is disabled. Re-enable it before delivering to it.',
  },
};

/**
 * Codes built at runtime from a channel name.
 *
 * `{CHANNEL}` is replaced with the uppercased channel, exactly as the throw
 * sites do it, so the catalogue enumerates the same strings a caller actually
 * receives rather than a prose description of the pattern.
 */
export const CHANNEL_ERROR_CODE_TEMPLATES: Array<{
  template: string;
  spec: Omit<ErrorCodeSpec, 'description'> & { description: string };
}> = [
  {
    template: 'VALIDATION_{CHANNEL}_CAPTION_TOO_LONG',
    spec: {
      status: 400,
      retryable: false,
      category: 'validation',
      description: 'The caption is longer than this channel permits.',
    },
  },
  {
    template: 'VALIDATION_{CHANNEL}_CONTENT_TOO_LONG',
    spec: {
      status: 400,
      retryable: false,
      category: 'validation',
      description: 'The post content is longer than this channel permits.',
    },
  },
  {
    template: 'VALIDATION_{CHANNEL}_REQUIRES_MEDIA',
    spec: {
      status: 400,
      retryable: false,
      category: 'validation',
      description: 'This channel does not accept a post without media.',
    },
  },
  {
    template: 'VALIDATION_{CHANNEL}_MEDIA_REQUIRED',
    spec: {
      status: 400,
      retryable: false,
      category: 'validation',
      description: 'This channel does not accept a post without media.',
    },
  },
  {
    template: 'VALIDATION_{CHANNEL}_TOO_MANY_MEDIA_ITEMS',
    spec: {
      status: 400,
      retryable: false,
      category: 'validation',
      description: 'The post carries more media items than this channel permits.',
    },
  },
  {
    template: 'VALIDATION_{CHANNEL}_VIDEO_NOT_SUPPORTED',
    spec: {
      status: 400,
      retryable: false,
      category: 'validation',
      description: 'This channel does not accept video.',
    },
  },
  {
    template: 'VALIDATION_{CHANNEL}_IMAGE_NOT_SUPPORTED',
    spec: {
      status: 400,
      retryable: false,
      category: 'validation',
      description: 'This channel does not accept images.',
    },
  },
  {
    template: 'VALIDATION_{CHANNEL}_VIDEO_MUST_BE_SINGLE_MEDIA',
    spec: {
      status: 400,
      retryable: false,
      category: 'validation',
      description: 'A video on this channel cannot be combined with other media.',
    },
  },
  {
    template: 'VALIDATION_{CHANNEL}_NOT_READY',
    spec: {
      status: 400,
      retryable: false,
      category: 'validation',
      description:
        'The connected account for this channel is not usable (disconnected, expired, or revoked). Reconnect it.',
    },
  },
];

export type ErrorCodeRecord = ErrorCodeSpec & { code: string };

let expandedCache: ErrorCodeRecord[] | null = null;

/**
 * Every code an API caller can receive, static and channel-generated alike.
 *
 * Sorted by status then code so the generated documentation and the OpenAPI
 * spec are byte-stable across runs, which is what lets CI diff them.
 */
export function listErrorCodes(): ErrorCodeRecord[] {
  if (expandedCache) return expandedCache;

  const records: ErrorCodeRecord[] = Object.entries(ERROR_CODES).map(([code, spec]) => ({
    code,
    ...spec,
  }));

  for (const { template, spec } of CHANNEL_ERROR_CODE_TEMPLATES) {
    for (const channel of socialChannels) {
      records.push({ code: template.replace('{CHANNEL}', channel.toUpperCase()), ...spec });
    }
  }

  records.sort((a, b) => a.status - b.status || a.code.localeCompare(b.code));
  expandedCache = records;
  return records;
}

let lookupCache: Map<string, ErrorCodeSpec> | null = null;

function lookupTable(): Map<string, ErrorCodeSpec> {
  if (lookupCache) return lookupCache;
  lookupCache = new Map(listErrorCodes().map((record) => [record.code, record as ErrorCodeSpec]));
  return lookupCache;
}

/**
 * The catalogue entry for a code, or `null` when it is not catalogued.
 *
 * Returning `null` rather than a guess is deliberate: `apiError()` keeps its
 * own fallback rules for uncatalogued codes, and conflating "we know this is a
 * 400" with "it starts with VALIDATION_ so it is probably a 400" would hide
 * exactly the codes worth adding here.
 */
export function resolveErrorCode(code: string): ErrorCodeSpec | null {
  return lookupTable().get(code) ?? null;
}

/** Whether an identical retry can plausibly succeed. Unknown codes are not retryable. */
export function isRetryableErrorCode(code: string): boolean {
  return resolveErrorCode(code)?.retryable ?? false;
}
