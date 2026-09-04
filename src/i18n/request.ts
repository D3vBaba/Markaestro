import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

/**
 * One namespace file per marketing page, loaded together per request. Small
 * enough that a per-request merge is simpler and safer than lazy
 * per-namespace loading, and keeps the completeness checker
 * (scripts/check-i18n.mjs) working against one predictable file list.
 *
 * The (app) tree is not locale-prefixed, so it never negotiates a locale
 * through this config — see src/app/(app)/layout.tsx, which resolves its
 * own locale from the signed-in member's stored preference and loads its
 * own `app*.json` namespace files directly.
 */
const NAMESPACES = [
  "common",
  "home",
  "features",
  "channels",
  "pricing",
  "contact",
  "developersApi",
  "developersAgents",
  "terms",
  "privacy",
] as const;

function mergeFallbacks(
  fallback: Record<string, unknown>,
  localized: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...fallback, ...localized };
  for (const [key, fallbackValue] of Object.entries(fallback)) {
    const localizedValue = localized[key];
    if (
      fallbackValue && typeof fallbackValue === "object" && !Array.isArray(fallbackValue) &&
      localizedValue && typeof localizedValue === "object" && !Array.isArray(localizedValue)
    ) {
      merged[key] = mergeFallbacks(
        fallbackValue as Record<string, unknown>,
        localizedValue as Record<string, unknown>,
      );
    }
  }
  return merged;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = routing.locales.includes(requested as (typeof routing.locales)[number])
    ? (requested as (typeof routing.locales)[number])
    : routing.defaultLocale;

  const load = (loc: string) =>
    Promise.all(
      NAMESPACES.map(async (namespace) => [
        namespace,
        (await import(`../messages/${loc}/${namespace}.json`)).default,
      ] as const),
    ).then((entries) => Object.fromEntries(entries) as Record<string, Record<string, unknown>>);

  // English is the source of truth. A key that has not been translated yet
  // falls back to the English string instead of rendering its path, so new
  // marketing sections can ship English-first.
  const localized = await load(locale);
  const messages = locale === "en" ? localized : mergeFallbacks(await load("en"), localized);

  return { locale, messages };
});
