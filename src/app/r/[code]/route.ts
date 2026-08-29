import { after, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { appendClickId, createClickId, recordTrackedLinkClick } from '@/lib/intelligence/conversions';
import {
  CLICK_DEDUPE_WINDOW_MS,
  classifyUserAgent,
  clickDedupeKey,
  clientIpFromHeaders,
} from '@/lib/intelligence/bot-filter';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { retiredLinkHtml } from './retired-link-page';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Decide whether this hit should be recorded as a real click.
 *
 * Runs before `after()` so a filtered hit costs zero Firestore writes, rather
 * than writing and cleaning up later. Every branch returns a decision, never
 * throws: the redirect is the product, and analytics bookkeeping must never be
 * able to break a customer's link.
 */
async function shouldRecordClick(req: Request, code: string): Promise<boolean> {
  if (classifyUserAgent(req.headers.get('user-agent')) === 'bot') return false;

  const ip = clientIpFromHeaders(req.headers);

  try {
    // Suppress repeat hits from the same visitor on the same code. Covers
    // double-taps and prefetch-then-navigate, where a client fetches the link
    // and the person immediately follows it. A limit of one per window is a
    // dedupe expressed in the limiter we already run.
    const dedupe = await checkRateLimit(
      `click-dedupe:${clickDedupeKey(code, ip)}`,
      { limit: 1, windowMs: CLICK_DEDUPE_WINDOW_MS },
    );
    if (!dedupe.allowed) return false;

    // Per-IP-per-code ceiling on the recording side effect only. A rate-limited
    // visitor still reaches their destination; only the analytics write is
    // skipped.
    const limited = await checkRateLimit(`redirect:${code}:${ip}`, RATE_LIMITS.redirect);
    return limited.allowed;
  } catch (error) {
    // The limiter itself failed. Record the click rather than lose it: a
    // Firestore blip should not silently zero a customer's analytics.
    logger.warn('tracked link click filtering failed; recording the click anyway', {
      event: 'intelligence.click_filter_failed',
      code,
      err: error,
    });
    return true;
  }
}

/**
 * Resolved links, cached in memory for a minute.
 *
 * Tracked links change rarely: a PATCH can repoint or retire one, but that is
 * a deliberate act by the owner, not traffic. A short cache turns a Firestore
 * blip into a non-event for any link that has been used recently, and bounds
 * the cost of a mutation to at most 60 seconds of a retired link still
 * redirecting (the cache is per instance, so a mutation cannot invalidate
 * every instance anyway). Per-instance and unbounded in nothing but time:
 * Cloud Run recycles instances often enough that the map cannot grow without
 * limit.
 */
type ResolvedLink = { data: FirebaseFirestore.DocumentData | null };
const LINK_CACHE_TTL_MS = 60_000;
const linkCache = new Map<string, { value: ResolvedLink; expiresAt: number }>();

async function resolveLink(code: string): Promise<ResolvedLink> {
  const now = Date.now();
  const cached = linkCache.get(code);
  if (cached && cached.expiresAt > now) return cached.value;

  const snapshot = await adminDb.doc(`trackedLinks/${code}`).get();
  const value: ResolvedLink = {
    data: snapshot.exists ? snapshot.data() ?? null : null,
  };
  linkCache.set(code, { value, expiresAt: now + LINK_CACHE_TTL_MS });
  return value;
}

/**
 * Where a visitor lands when the redirect itself fails.
 *
 * The redirect is the product: a Firestore outage must not turn a customer's
 * tracked link into a stack trace in the visitor's browser. An explanation
 * page they can read is the only honest degradation, since we do not know
 * where they were going.
 */
function linkErrorRedirect(req: Request): NextResponse {
  const url = new URL('/link-unavailable', new URL(req.url).origin);
  return NextResponse.redirect(url, 302);
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  // Whole body guarded: a Firestore read failure, a malformed document, or a
  // limiter fault used to escape as a framework 500 with no requestId and an
  // unparseable body.
  try {
    const { data } = await resolveLink(code);
    if (!data) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    // A retired link is a different answer from an unknown one: the code was
    // real and its owner withdrew it. 410 says that precisely, and a person
    // following it from a post gets a page rather than a JSON error.
    if (data.active === false) {
      return new NextResponse(retiredLinkHtml(), {
        status: 410,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'private, no-store',
        },
      });
    }
    let destination: string;
    const clickId = createClickId();
    try {
      destination = appendClickId(String(data.destination), clickId);
    } catch {
      return NextResponse.json({ error: 'INVALID_DESTINATION' }, { status: 410 });
    }
    const clickedAt = new Date().toISOString();
    const record = await shouldRecordClick(req, code);
    if (record) {
      after(async () => {
        // The conversionClicks write had no catch of its own, so a failure
        // here was an unhandled rejection in a background task: invisible in
        // the response and, depending on the runtime, fatal to the whole
        // after() callback (taking the counter update with it).
        try {
          await adminDb.doc(`conversionClicks/${clickId}`).set({
            clickId,
            workspaceId: data.workspaceId,
            productId: data.productId,
            campaignId: data.campaignId || null,
            socialPostId: data.socialPostId || null,
            trackedLinkCode: code,
            clickedAt,
            expiresAt: new Date(Date.parse(clickedAt) + 90 * 24 * 60 * 60_000),
            consentState: req.headers.get('sec-gpc') === '1' ? 'limited' : 'unknown',
            // Only the derived classification is kept. Deliberately no raw IP,
            // user-agent, or referrer.
            classification: 'human',
          });
        } catch (error) {
          logger.error('tracked link click write failed', {
            event: 'intelligence.click_write_failed',
            code,
            err: error,
          });
        }
        await recordTrackedLinkClick({ workspaceId: String(data.workspaceId), code, clickedAt }).catch(() => undefined);
      });
    }
    return NextResponse.redirect(destination, 302);
  } catch (error) {
    logger.error('tracked link redirect failed', {
      event: 'intelligence.redirect_failed',
      code,
      err: error,
    });
    return linkErrorRedirect(req);
  }
}
