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
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--mk-surface)" }}
    >
      {/* ─── Navbar ─── */}
      <header
        className="sticky top-0 z-50 border-b backdrop-blur-md"
        style={{
          background: "color-mix(in oklch, var(--mk-paper) 92%, transparent)",
          borderColor: "var(--mk-rule)",
        }}
      >
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/markaestro-logo-transparent.png"
              alt="Markaestro"
              width={28}
              height={28}
              className="object-contain"
            />
            <span
              className="text-[15px] font-semibold"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.015em" }}
            >
              Markaestro
            </span>
          </Link>

          {/* gap tightens at md so six links still clear the logo + CTAs */}
          <nav className="hidden md:flex items-center gap-5 lg:gap-7">
            {navLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-[13px] transition-colors"
                  style={{
                    color: active ? "var(--mk-ink)" : "var(--mk-ink-60)",
                    fontWeight: active ? 500 : 400,
                    letterSpacing: "-0.005em",
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2.5">
            {!hideLocaleSwitcher && <LocaleSwitcher />}
            {user ? (
              <NextLink href="/dashboard">
                <Button className="rounded-lg h-9 text-[13px]">
                  {t("nav.dashboard")}
                </Button>
              </NextLink>
            ) : (
              <>
                <NextLink href="/login" className="hidden sm:block">
                  <Button variant="ghost" className="h-9 rounded-lg text-[13px]">
                    {t("nav.signIn")}
                  </Button>
                </NextLink>
                <NextLink href="/onboarding">
                  <Button className="rounded-lg h-9 text-[13px]">
                    {t("nav.getStarted")}
                  </Button>
                </NextLink>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9 rounded-lg"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div
            className="md:hidden border-t px-5 pb-4 pt-2"
            style={{
              background: "var(--mk-paper)",
              borderColor: "var(--mk-rule)",
            }}
          >
            {navLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block py-3 text-[14px] transition-colors border-b last:border-0"
                  style={{
                    color: active ? "var(--mk-ink)" : "var(--mk-ink-60)",
                    fontWeight: active ? 500 : 400,
                    borderColor: "var(--mk-rule-soft)",
                    letterSpacing: "-0.005em",
                  }}
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              );
            })}
            {/* Sign in lives here on mobile — the header button is sm+ only */}
            {!user && (
              <NextLink
                href="/login"
                className="block py-3 text-[14px] transition-colors sm:hidden"
                style={{
                  color: "var(--mk-ink-60)",
                  letterSpacing: "-0.005em",
                }}
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
      <footer
        className="border-t"
        style={{
          background: "var(--mk-paper)",
          borderColor: "var(--mk-rule)",
        }}
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-6 py-14">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <div className="flex items-center gap-2.5">
                <Image
                  src="/markaestro-logo-transparent.png"
                  alt="Markaestro"
                  width={24}
                  height={24}
                  className="object-contain"
                />
                <span
                  className="text-[14px] font-semibold"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.015em" }}
                >
                  Markaestro
                </span>
              </div>
              <p
                className="mt-4 text-[12.5px] leading-relaxed"
                style={{ color: "var(--mk-ink-60)" }}
              >
                {t("footer.tagline")}
              </p>
            </div>

            <div>
              <p className="mk-eyebrow">{t("footer.productHeading")}</p>
              <div className="mt-4 flex flex-col gap-3">
                {footerProductLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-[13px] transition-colors"
                    style={{ color: "var(--mk-ink-60)" }}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="mk-eyebrow">{t("footer.developersHeading")}</p>
              <div className="mt-4 flex flex-col gap-3">
                {footerDeveloperLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-[13px] transition-colors"
                    style={{ color: "var(--mk-ink-60)" }}
                  >
                    {l.label}
                  </Link>
                ))}
                {/* Static text brief for agents/crawlers — not a Next route,
                    and not locale-routed (see task 14 notes on llms.txt). */}
                <a
                  href="/llms.txt"
                  className="text-[13px] transition-colors"
                  style={{ color: "var(--mk-ink-60)" }}
                >
                  {t("footer.agentBrief")}
                </a>
              </div>
            </div>

            <div>
              <p className="mk-eyebrow">{t("footer.companyHeading")}</p>
              <div className="mt-4 flex flex-col gap-3">
                {footerCompanyLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-[13px] transition-colors"
                    style={{ color: "var(--mk-ink-60)" }}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="mk-eyebrow">{t("footer.getStartedHeading")}</p>
              <div className="mt-4 flex flex-col gap-3">
                <NextLink
                  href="/login"
                  className="text-[13px]"
                  style={{ color: "var(--mk-ink-60)" }}
                >
                  {t("footer.signIn")}
                </NextLink>
                <NextLink
                  href="/onboarding"
                  className="text-[13px]"
                  style={{ color: "var(--mk-ink-60)" }}
                >
                  {t("footer.createAccount")}
                </NextLink>
              </div>
            </div>
          </div>

          <div
            className="mt-14 flex flex-col items-center gap-4 border-t pt-7 sm:flex-row sm:justify-between"
            style={{ borderColor: "var(--mk-rule)" }}
          >
            <p
              className="text-[11.5px]"
              style={{ color: "var(--mk-ink-40)" }}
            >
              {t("footer.copyright", { year: new Date().getFullYear() })}
            </p>
            <div className="flex gap-6">
              {footerBottomLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-[11.5px]"
                  style={{ color: "var(--mk-ink-40)" }}
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
