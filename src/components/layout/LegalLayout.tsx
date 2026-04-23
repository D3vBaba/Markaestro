import Link from "next/link";
import Image from "next/image";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--mk-surface)" }}
    >
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{
          background: "color-mix(in oklch, var(--mk-paper) 92%, transparent)",
          borderColor: "var(--mk-rule)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/markaestro-logo-transparent.png"
              alt="Markaestro"
              width={26}
              height={26}
              className="object-contain"
            />
            <span
              className="text-[14px] font-semibold"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.015em" }}
            >
              Markaestro
            </span>
          </Link>
          <Link
            href="/login"
            className="text-[13px] transition-colors"
            style={{ color: "var(--mk-ink-60)" }}
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-5 sm:px-6 py-12 lg:py-16">
          {children}
        </div>
      </main>

      <footer
        className="border-t"
        style={{
          background: "var(--mk-paper)",
          borderColor: "var(--mk-rule)",
        }}
      >
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 px-5 sm:px-6 py-8 sm:flex-row sm:justify-between">
          <p
            className="text-[11.5px]"
            style={{ color: "var(--mk-ink-40)" }}
          >
            &copy; {new Date().getFullYear()} Markaestro. All rights reserved.
          </p>
          <nav className="flex gap-6">
            {[
              { href: "/terms", label: "Terms of Service" },
              { href: "/privacy", label: "Privacy Policy" },
              { href: "/contact", label: "Contact Us" },
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
          </nav>
        </div>
      </footer>
    </div>
  );
}
