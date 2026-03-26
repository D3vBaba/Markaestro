import Link from "next/link";
import Image from "next/image";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md border bg-white p-0.5 shadow-sm">
              <Image src="/markaestro-logo.png" alt="Markaestro" width={28} height={28} className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Markaestro</span>
          </Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition">
            Sign In
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-6 py-12 lg:py-16">
          {children}
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-6 py-8 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Markaestro. All rights reserved.</p>
          <nav className="flex gap-6">
            <Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition">Terms of Service</Link>
            <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition">Privacy Policy</Link>
            <Link href="/contact" className="text-xs text-muted-foreground hover:text-foreground transition">Contact Us</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
