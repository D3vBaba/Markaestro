import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Noto_Sans_Arabic } from "next/font/google";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { DirectionProvider } from "@/components/ui/direction-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { isRtlLocale, type AppLocale } from "@/i18n/routing";
import { isLocaleRoutedPath, stripLocale } from "@/lib/proxy-paths";
import { resolveAppLocale } from "@/lib/resolve-app-locale";

/**
 * next-intl's getLocale() only resolves correctly for pages nested under
 * src/app/[locale]/... — outside that segment (the (app) route group) it has
 * no URL locale to negotiate against and always returns the default locale.
 * proxy.ts forwards the real request path via the x-pathname header (see
 * nextWithPathname there); when that path isn't one of the locale-routed
 * marketing pages, this is the (app) tree, and we resolve its locale the
 * same way (app)/layout.tsx does — signed-in member preference, else
 * Accept-Language — so `<html lang/dir>` matches what the page actually
 * renders instead of silently staying "en"/"ltr" for every app route.
 */
async function resolveRootLocale(): Promise<AppLocale> {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname");
  if (pathname) {
    const { rest } = stripLocale(pathname);
    if (!isLocaleRoutedPath(rest)) {
      return resolveAppLocale();
    }
  }
  return getLocale() as Promise<AppLocale>;
}

// NOTE: The Firebase-backed auth/subscription/workspace providers were moved
// out of the root layout and into the (app) route group layout
// (src/app/(app)/layout.tsx). Marketing pages in the (marketing) group no
// longer mount those providers, so anonymous marketing traffic never
// initialises the Firebase client SDK or its auth listener.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geist has zero Arabic glyph coverage (Latin-only family). For the `ar`
// locale we override --font-geist-sans (which --font-sans resolves to, see
// globals.css `@theme inline`) so every `font-sans` usage — body copy and
// headings alike — picks this up instead, with no component-level changes.
// --font-mono (used by .mk-eyebrow labels) is left on Geist Mono: browsers
// fall back to the OS's Arabic-capable UI font for that small amount of
// mono-styled text, which is an acceptable gap for a handful of short labels.
const notoSansArabic = Noto_Sans_Arabic({
  variable: "--font-noto-sans-arabic",
  subsets: ["arabic"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7faff" },
    { media: "(prefers-color-scheme: dark)", color: "#f7faff" },
  ],
};

export const metadata: Metadata = {
  title: "Markaestro | Premium Brand Marketing",
  description: "Publish, schedule, and measure every brand you market (products, businesses, clients, or yourself) with Markaestro, the ethical and premium marketing engine.",
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon.ico',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveRootLocale();
  const rtl = isRtlLocale(locale);

  return (
    <html lang={locale} dir={rtl ? "rtl" : "ltr"}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSansArabic.variable} antialiased bg-background text-foreground selection:bg-primary/15 selection:text-foreground`}
        style={rtl ? ({ "--font-geist-sans": "var(--font-noto-sans-arabic)" } as React.CSSProperties) : undefined}
      >
        <DirectionProvider dir={rtl ? "rtl" : "ltr"}>
          <TooltipProvider>
            {children}
            <Toaster
              position="bottom-right"
              mobileOffset={{ bottom: "76px" }}
              dir={rtl ? "rtl" : "ltr"}
              toastOptions={{
                classNames: {
                  toast:
                    "!rounded-xl !border !border-border !bg-card !text-foreground !shadow-lg !shadow-black/5",
                  description: "!text-muted-foreground",
                  actionButton: "!bg-primary !text-primary-foreground",
                  cancelButton: "!bg-muted !text-foreground",
                },
              }}
            />
          </TooltipProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
