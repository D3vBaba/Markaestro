"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { ArrowRight, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/channels", label: "Channels" },
  { href: "/ai-studio", label: "AI Studio" },
  { href: "/contact", label: "Contact" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ─── Navbar ─── */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/markaestro-logo-transparent.png" alt="Markaestro" width={40} height={36} className="object-contain" />
            <span className="text-base font-bold tracking-tight">Markaestro</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-sm transition",
                  pathname === link.href
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {user ? (
              <Link href="/dashboard">
                <Button>Go to Dashboard <ArrowRight className="ml-1.5 h-4 w-4" /></Button>
              </Link>
            ) : (
              <>
                <Link href="/login" className="hidden sm:block">
                  <Button variant="ghost" className="text-sm">Sign In</Button>
                </Link>
                <Link href="/login">
                  <Button className="text-sm">Get Started <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
                </Link>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden border-t bg-background px-6 pb-4 pt-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "block py-3 text-sm transition border-b border-border/40 last:border-0",
                  pathname === link.href
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                )}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </header>

      {/* ─── Content ─── */}
      <main className="flex-1">{children}</main>

      {/* ─── Footer ─── */}
      <footer className="border-t bg-background">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-3">
                <Image src="/markaestro-logo-transparent.png" alt="Markaestro" width={32} height={28} className="object-contain" />
                <span className="text-sm font-bold tracking-tight">Markaestro</span>
              </div>
              <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
                The premium marketing automation platform for modern teams.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Product</p>
              <div className="mt-5 flex flex-col gap-3">
                <Link href="/features" className="text-sm text-muted-foreground hover:text-foreground transition">Features</Link>
                <Link href="/channels" className="text-sm text-muted-foreground hover:text-foreground transition">Channels</Link>
                <Link href="/ai-studio" className="text-sm text-muted-foreground hover:text-foreground transition">AI Studio</Link>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Company</p>
              <div className="mt-5 flex flex-col gap-3">
                <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground transition">Contact</Link>
                <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition">Terms of Service</Link>
                <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition">Privacy Policy</Link>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Get Started</p>
              <div className="mt-5 flex flex-col gap-3">
                <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">Sign In</Link>
                <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">Create Account</Link>
              </div>
            </div>
          </div>

          <div className="mt-16 flex flex-col items-center gap-4 border-t pt-8 sm:flex-row sm:justify-between">
            <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Markaestro. All rights reserved.</p>
            <div className="flex gap-6">
              <Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition">Terms</Link>
              <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition">Privacy</Link>
              <Link href="/contact" className="text-xs text-muted-foreground hover:text-foreground transition">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
