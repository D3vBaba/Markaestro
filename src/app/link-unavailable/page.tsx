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
        <p className="mk-eyebrow">Link</p>
        <h1
          className="mt-5 text-[26px] sm:text-[30px] font-semibold leading-[1.1]"
          style={{ color: "var(--mk-ink)", letterSpacing: "-0.025em" }}
        >
          This link is temporarily unavailable
        </h1>
        <p
          className="mt-3 text-[14px] leading-relaxed"
          style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
        >
          We could not look up where this link goes. Nothing is wrong with the
          link itself, so refreshing in a moment will usually work.
        </p>
      </div>
    </div>
  );
}
