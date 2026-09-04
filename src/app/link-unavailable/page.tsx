import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Link unavailable",
  // A transient failure page must never be indexed in place of the
  // destination the link actually points at.
  robots: { index: false, follow: false },
};

/**
 * Where `/r/[code]` sends a visitor when the redirect itself fails.
 *
 * The link shortener is public and unauthenticated, and its whole job is to
 * forward someone to a customer's page. When the lookup fails, the honest
 * answer is "this link is temporarily unavailable, try again", not a 500 with
 * an unparseable body. We deliberately do not offer a "go home" button: this
 * visitor came from a customer's post and has no relationship with us, so
 * sending them to our marketing site would be an ad, not help.
 */
export default function LinkUnavailablePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-5">
      <div className="mx-auto max-w-md text-center">
        <Image
          src="/markaestro-logo-transparent.png"
          alt="Markaestro"
          width={32}
          height={32}
          className="mx-auto mb-8 size-8 object-contain"
        />
        <h1 className="m-0 text-2xl font-semibold leading-tight tracking-tight text-foreground text-balance sm:text-3xl">
          This link is temporarily unavailable
        </h1>
        <p className="m-0 mt-3 text-[15px] leading-6 text-mk-ink-80 text-pretty">
          We could not look up where this link goes. Nothing is wrong with the
          link itself, so refreshing in a moment will usually work.
        </p>
      </div>
    </div>
  );
}
