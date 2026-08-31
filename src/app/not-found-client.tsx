"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5"
      style={{ background: "var(--mk-surface)" }}
    >
      <div className="mx-auto max-w-md text-center">
        <Image
          src="/markaestro-logo-transparent.png"
          alt="Markaestro"
          width={40}
          height={40}
          className="mx-auto object-contain mb-7"
        />
        <p className="mk-eyebrow">Error · 404</p>
        <p
          className="mt-2 font-mono text-[80px] font-semibold leading-none mk-figure"
          style={{ color: "var(--mk-accent)", letterSpacing: "-0.04em" }}
        >
          404
        </p>
        <h1
          className="mt-5 text-[26px] sm:text-[30px] font-semibold leading-[1.1]"
          style={{ color: "var(--mk-ink)", letterSpacing: "-0.025em" }}
        >
          Page not found
        </h1>
        <p
          className="mt-3 text-[14px] leading-relaxed"
          style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
        >
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          Let&apos;s get you back on track.
        </p>
        <div className="mt-7 flex flex-col items-center gap-2.5 sm:flex-row sm:justify-center">
          <Link href="/">
            <Button className="h-11 px-7 rounded-lg text-[13.5px]">
              Go home
            </Button>
          </Link>
          <Button
            variant="outline"
            className="h-11 px-7 rounded-lg text-[13.5px]"
            onClick={() => history.back()}
          >
            Go back
          </Button>
        </div>
        <div
          className="mt-12 flex justify-center gap-6 text-[11.5px]"
          style={{ color: "var(--mk-ink-60)" }}
        >
          {[
            { href: "/features", label: "Features" },
            { href: "/pricing", label: "Pricing" },
            { href: "/contact", label: "Contact" },
          ].map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
