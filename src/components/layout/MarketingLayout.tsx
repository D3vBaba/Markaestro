"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState } from "react";

const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/channels", label: "Channels" },
  { href: "/developers/api", label: "API" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

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

          <nav className="hidden md:flex items-center gap-7">
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
            {user ? (
              <Link href="/dashboard">
                <Button className="rounded-lg h-9 text-[13px]">
                  Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/login" className="hidden sm:block">
                  <Button variant="ghost" className="h-9 rounded-lg text-[13px]">
                    Sign in
                  </Button>
                </Link>
                <Link href="/login">
                  <Button className="rounded-lg h-9 text-[13px]">
                    Get started
                  </Button>
                </Link>
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
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
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
                The marketing automation platform for modern teams.
              </p>
            </div>

            <div>
              <p className="mk-eyebrow">Product</p>
              <div className="mt-4 flex flex-col gap-3">
                {[
                  { href: "/features", label: "Features" },
                  { href: "/channels", label: "Channels" },
                  { href: "/pricing", label: "Pricing" },
                ].map((l) => (
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
              <p className="mk-eyebrow">Company</p>
              <div className="mt-4 flex flex-col gap-3">
                {[
                  { href: "/contact", label: "Contact" },
                  { href: "/terms", label: "Terms of Service" },
                  { href: "/privacy", label: "Privacy Policy" },
                ].map((l) => (
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
              <p className="mk-eyebrow">Get started</p>
              <div className="mt-4 flex flex-col gap-3">
                <Link
                  href="/login"
                  className="text-[13px]"
                  style={{ color: "var(--mk-ink-60)" }}
                >
                  Sign in
                </Link>
                <Link
                  href="/login"
                  className="text-[13px]"
                  style={{ color: "var(--mk-ink-60)" }}
                >
                  Create account
                </Link>
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
              &copy; {new Date().getFullYear()} Markaestro. All rights reserved.
            </p>
            <div className="flex gap-6">
              {[
                { href: "/terms", label: "Terms" },
                { href: "/privacy", label: "Privacy" },
                { href: "/contact", label: "Contact" },
              ].map((l) => (
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
