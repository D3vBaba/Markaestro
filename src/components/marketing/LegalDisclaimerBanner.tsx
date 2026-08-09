"use client";

/**
 * Shown only on non-English Terms/Privacy — these are machine-assisted
 * translations, not certified legal translations. The English page stays the
 * authoritative text; this banner and its link make that unambiguous rather
 * than presenting translated legal text as if it carried equal standing.
 */

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function LegalDisclaimerBanner({ englishHref }: { englishHref: string }) {
  const locale = useLocale();
  const t = useTranslations();

  if (locale === "en") return null;

  return (
    <div
      className="mb-8 rounded-xl border p-4 text-[13px] leading-relaxed"
      style={{ borderColor: "var(--mk-warn)", background: "color-mix(in oklch, var(--mk-warn) 12%, transparent)" }}
    >
      <p style={{ color: "var(--mk-ink-80)" }}>
        {t("common.legalDisclaimer.text")}{" "}
        <Link href={englishHref} locale="en" className="underline underline-offset-2 font-medium">
          {t("common.legalDisclaimer.viewEnglish")}
        </Link>
      </p>
    </div>
  );
}
