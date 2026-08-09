import { NextIntlClientProvider } from "next-intl";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { SubscriptionProvider } from "@/components/providers/SubscriptionProvider";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { resolveAppLocale } from "@/lib/resolve-app-locale";

/**
 * One namespace file per app surface, loaded together per request — mirrors
 * src/i18n/request.ts's marketing NAMESPACES list. Extend this map as each
 * surface's translations land; a namespace absent here just never loads.
 * Filenames are listed explicitly (rather than derived from the key) so the
 * dynamic import below stays a plain two-variable template — the shape
 * bundlers can statically resolve into a scoped context module instead of
 * pulling in every message file under src/messages.
 */
const APP_NAMESPACE_FILES = {
  shell: "appShell",
  appCommon: "appCommon",
  dashboard: "appDashboard",
  settings: "appSettings",
  onboarding: "appOnboarding",
  calendar: "appCalendar",
  content: "appContent",
  products: "appProducts",
  analytics: "appAnalytics",
  auth: "appAuth",
  guidesChannels: "appGuidesChannels",
} as const;

/**
 * Layout for the application surface (app.markaestro.com).
 *
 * The Firebase-backed providers live here rather than in the root layout so
 * that only authenticated app routes initialise the Firebase client SDK and
 * its auth listener. Marketing pages in the (marketing) group are
 * intentionally provider-free.
 */
export default async function AppGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveAppLocale();
  const [messages, marketingCommon] = await Promise.all([
    Object.fromEntries(
      await Promise.all(
        Object.entries(APP_NAMESPACE_FILES).map(async ([namespace, file]) => [
          namespace,
          (await import(`../../messages/${locale}/${file}.json`)).default,
        ]),
      ),
    ),
    // login/page.tsx and auth/action/page.tsx render <MarketingLayout>,
    // which needs the marketing common.json namespace (nav, footer,
    // localeSwitcher, copyBlock) even though these two routes live outside
    // the locale-prefixed [locale] tree.
    import(`../../messages/${locale}/common.json`).then((m) => m.default),
  ]);
  messages.common = marketingCommon;

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AuthProvider>
        <SubscriptionProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </NextIntlClientProvider>
  );
}
