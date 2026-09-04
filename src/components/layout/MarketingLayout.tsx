"use client";

import Image from "next/image";
import NextLink from "next/link";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useOptionalAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import LocaleSwitcher from "@/components/marketing/LocaleSwitcher";
import { Menu, X } from "lucide-react";
import { useState } from "react";

export default function MarketingLayout({
  children,
  hideLocaleSwitcher = false,
}: {
  children: React.ReactNode;
  /**
   * Set on pages that live in the (app) route tree (e.g. /login,
   * /auth/action) rather than under [locale] — the marketing LocaleSwitcher
   * navigates via a locale-prefixed URL (next-intl's routing), which has no
   * corresponding route there and would 404. Those pages resolve locale
   * server-side instead (see (app)/layout.tsx), with no in-page switcher.
   */
  hideLocaleSwitcher?: boolean;
}) {
  const t = useTranslations("common");
  const { user } = useOptionalAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { href: "/features", label: t("nav.features") },
    { href: "/channels", label: t("nav.channels") },
    { href: "/developers/agents", label: t("nav.aiAgents") },
    { href: "/developers/api", label: t("nav.api") },
    { href: "/pricing", label: t("nav.pricing") },
    { href: "/contact", label: t("nav.contact") },
  ];

  const footerProductLinks = [
    { href: "/features", label: t("footer.features") },
    { href: "/channels", label: t("footer.channels") },
    { href: "/pricing", label: t("footer.pricing") },
  ];

  const footerDeveloperLinks = [
    { href: "/developers/agents", label: t("footer.aiAgents") },
    { href: "/developers/api", label: t("footer.apiReference") },
  ];

  const footerCompanyLinks = [
    { href: "/contact", label: t("footer.contact") },
    { href: "/terms", label: t("footer.termsOfService") },
    { href: "/privacy", label: t("footer.privacyPolicy") },
  ];

  const footerBottomLinks = [
    { href: "/terms", label: t("footer.terms") },
    { href: "/privacy", label: t("footer.privacy") },
    { href: "/contact", label: t("footer.contact") },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* ─── Navbar ─── */}
      <header className="mk-glass sticky top-0 z-50 border-b border-border">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/markaestro-logo-transparent.png"
              alt="Markaestro"
              width={32}
              height={32}
              className="size-8 object-contain"
            />
            <span className="text-lg font-bold tracking-tight text-foreground">
              Markaestro
            </span>
          </Link>

          {/* gap tightens at md so six links still clear the logo + CTAs */}
          <nav className="hidden md:flex items-center gap-6 lg:gap-8">
            {navLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-[13.5px] font-medium transition-colors ${
                    active
                      ? "text-mk-accent "
                      : "text-mk-ink-80  hover:text-foreground "
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            {!hideLocaleSwitcher && <LocaleSwitcher />}
            {user ? (
              <NextLink href="/dashboard">
                <Button className="rounded-lg h-9 text-[13px] font-semibold bg-primary hover:bg-primary/88 text-primary-foreground">
                  {t("nav.dashboard")}
                </Button>
              </NextLink>
            ) : (
              <>
                <NextLink href="/login" className="hidden sm:block">
                  <Button variant="ghost" className="h-9 rounded-lg text-[13px] font-medium text-mk-ink-80 hover:text-foreground">
                    {t("nav.signIn")}
                  </Button>
                </NextLink>
                <NextLink href="/onboarding">
                  <Button className="rounded-lg h-9 text-[13px] font-semibold bg-primary hover:bg-primary/88 text-primary-foreground shadow-blue-500/20">
                    {t("nav.getStarted")}
                  </Button>
                </NextLink>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9 rounded-lg text-mk-ink-80"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-border px-5 pb-5 pt-3 bg-card">
            {navLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`block py-3 text-[14px] font-medium transition-colors border-b border-mk-rule-soft last:border-0 ${
                    active
                      ? "text-mk-accent "
                      : "text-mk-ink-80 "
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              );
            })}
            {!user && (
              <NextLink
                href="/login"
                className="block py-3 text-[14px] font-medium text-mk-ink-80 sm:hidden"
                onClick={() => setMobileOpen(false)}
              >
                {t("nav.signIn")}
              </NextLink>
            )}
          </div>
        )}
      </header>

      {/* ─── Content ─── */}
      <main className="flex-1">{children}</main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-16">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Link href="/" className="flex items-center gap-3">
                <Image
                  src="/markaestro-logo-transparent.png"
                  alt="Markaestro"
                  width={36}
                  height={36}
                  className="h-9 w-9 object-contain"
                />
                <span className="text-lg font-semibold tracking-tight text-foreground">
                  Markaestro
                </span>
              </Link>
              <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
                {t("footer.tagline")}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("footer.productHeading")}</p>
              <div className="mt-4 flex flex-col gap-2.5">
                {footerProductLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-[13px] text-mk-ink-80 hover:text-mk-accent transition-colors"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("footer.developersHeading")}</p>
              <div className="mt-4 flex flex-col gap-2.5">
                {footerDeveloperLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-[13px] text-mk-ink-80 hover:text-mk-accent transition-colors"
                  >
                    {l.label}
                  </Link>
                ))}
                <a
                  href="/llms.txt"
                  className="text-[13px] text-mk-ink-80 hover:text-mk-accent transition-colors"
                >
                  {t("footer.agentBrief")}
                </a>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("footer.companyHeading")}</p>
              <div className="mt-4 flex flex-col gap-2.5">
                {footerCompanyLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-[13px] text-mk-ink-80 hover:text-mk-accent transition-colors"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("footer.getStartedHeading")}</p>
              <div className="mt-4 flex flex-col gap-2.5">
                <NextLink
                  href="/login"
                  className="text-[13px] text-mk-ink-80 hover:text-mk-accent transition-colors"
                >
                  {t("footer.signIn")}
                </NextLink>
                <NextLink
                  href="/onboarding"
                  className="text-[13px] text-mk-ink-80 hover:text-mk-accent transition-colors"
                >
                  {t("footer.createAccount")}
                </NextLink>
              </div>
            </div>
          </div>

          <div className="mt-14 flex flex-col items-center gap-4 border-t border-mk-rule-soft pt-8 sm:flex-row sm:justify-between">
            <p className="text-xs text-mk-ink-40">
              {t("footer.copyright", { year: new Date().getFullYear() })}
            </p>
            <div className="flex gap-6">
              {footerBottomLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}

