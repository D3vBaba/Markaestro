"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      <div className="mx-auto max-w-md text-center">
        <Image
          src="/markaestro-logo-transparent.png"
          alt="Markaestro"
          width={48}
          height={44}
          className="mx-auto object-contain mb-8"
        />
        <p className="text-8xl font-bold tracking-tight text-primary">404</p>
        <h1 className="mt-4 text-2xl font-normal tracking-tight font-[family-name:var(--font-display)]">
          Page not found
        </h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or has been moved. Let&apos;s get you back on track.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/">
            <Button className="rounded-xl">
              Go Home
            </Button>
          </Link>
          <Button variant="outline" className="rounded-xl" onClick={() => history.back()}>
            Go Back
          </Button>
        </div>
        <div className="mt-12 flex justify-center gap-6 text-xs text-muted-foreground">
          <Link href="/features" className="hover:text-foreground transition">Features</Link>
          <Link href="/pricing" className="hover:text-foreground transition">Pricing</Link>
          <Link href="/contact" className="hover:text-foreground transition">Contact</Link>
        </div>
      </div>
    </div>
  );
}
