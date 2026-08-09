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

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = routing.locales.includes(requested as (typeof routing.locales)[number])
    ? (requested as (typeof routing.locales)[number])
    : routing.defaultLocale;

  const messages = Object.fromEntries(
    await Promise.all(
      NAMESPACES.map(async (namespace) => [
        namespace,
        (await import(`../messages/${locale}/${namespace}.json`)).default,
      ]),
    ),
  );

  return { locale, messages };
});
