import { defineRouting } from "next-intl/routing";

/**
 * Deliberately navigation-free — `next-intl/navigation`'s createNavigation
 * (and next-intl/middleware) transitively import `next/server`, which only
 * resolves inside Next.js's own build pipeline. proxy.ts's pure path-
 * classification helpers (stripLocale, isPublicPath, ...) import `routing`
 * from this file so they stay importable from plain vitest tests — see
 * src/i18n/navigation.ts for the Link/usePathname/useRouter exports.
 */

/**
 * `en` is deliberately unprefixed (`localePrefix: "as-needed"`): the public
 * API docs (docs/PUBLIC_API.md), public/llms.txt, and the sitemap all hardcode
 * bare English paths like markaestro.com/developers/agents. Prefixing the
 * default locale would break every one of those external references.
 *
 * `pt` ships Brazilian Portuguese content (pt-BR) — the dominant market for
 * social-media-marketing SaaS — under the plain `pt` segment, not `pt-BR`.
 * `zh` ships Simplified Chinese content under the plain `zh` segment.
 */
export const routing = defineRouting({
  locales: ["en", "es", "fr", "de", "pt", "ja", "zh", "ko", "it", "nl", "ar"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

export type AppLocale = (typeof routing.locales)[number];

export const RTL_LOCALES: ReadonlySet<AppLocale> = new Set(["ar"]);

export function isRtlLocale(locale: string): boolean {
  return RTL_LOCALES.has(locale as AppLocale);
}

export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  ja: "日本語",
  zh: "简体中文",
  ko: "한국어",
  it: "Italiano",
  nl: "Nederlands",
  ar: "العربية",
};

export function isAppLocale(value: string): value is AppLocale {
  return (routing.locales as readonly string[]).includes(value);
}

/**
 * Picks the best-supported locale from a raw `Accept-Language` header value,
 * used to default a new member's stored preference before they've had a
 * chance to pick one in Settings. Matches `xx-YY` variants (e.g. `pt-BR`) to
 * their base `xx` when the exact tag isn't a supported locale.
 */
export function pickLocaleFromAcceptLanguage(header: string | null | undefined): AppLocale {
  if (!header) return routing.defaultLocale;

  const tags = header
    .split(",")
    .map((part) => {
      const [tag, qStr] = part.trim().split(";q=");
      const q = qStr ? parseFloat(qStr) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tags) {
    if (isAppLocale(tag)) return tag;
    const base = tag.split("-")[0];
    if (isAppLocale(base)) return base;
  }

  return routing.defaultLocale;
}
