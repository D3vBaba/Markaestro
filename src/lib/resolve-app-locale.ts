import { cookies, headers } from "next/headers";
import { decodeSessionCookie } from "@/lib/session-cookie";
import { adminDb } from "@/lib/firebase-admin";
import { isAppLocale, pickLocaleFromAcceptLanguage, type AppLocale } from "@/i18n/routing";

/**
 * Looks up a signed-in member's stored locale preference directly by uid —
 * no cookie/session decoding, for call sites (email senders, background
 * jobs) that already have a verified uid in hand. Returns null if the
 * member has no doc yet or hasn't set a preference, so callers can fall
 * back to Accept-Language or a default.
 */
export async function resolveMemberLocale(uid: string): Promise<AppLocale | null> {
  try {
    const snap = await adminDb
      .collectionGroup("members")
      .where("uid", "==", uid)
      .limit(1)
      .get();
    const stored = snap.docs[0]?.data()?.locale;
    if (typeof stored === "string" && isAppLocale(stored)) {
      return stored;
    }
  } catch {
    // A lookup failure should never block the caller — treat as "unknown".
  }
  return null;
}

/**
 * The (app) tree carries no locale segment, so next-intl's own
 * getLocale()/getMessages() negotiation (which resolves against the URL)
 * always falls back to the default locale here — it has nothing to
 * negotiate against. Resolve the locale ourselves instead: the signed-in
 * member's stored preference (workspaces/*\/members/{uid}.locale) takes
 * priority, falling back to Accept-Language for logged-out or
 * not-yet-bootstrapped requests.
 *
 * Shared by (app)/layout.tsx (message loading) and the root layout
 * (html lang/dir) — both need the same resolved locale for the same request.
 */
export async function resolveAppLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("__session")?.value;

  if (sessionCookie) {
    const decoded = await decodeSessionCookie(sessionCookie);
    if (decoded) {
      const stored = await resolveMemberLocale(decoded.uid);
      if (stored) return stored;
    }
  }

  const headerList = await headers();
  return pickLocaleFromAcceptLanguage(headerList.get("accept-language"));
}
