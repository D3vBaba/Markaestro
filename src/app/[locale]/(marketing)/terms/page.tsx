"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import MarketingLayout from "@/components/layout/MarketingLayout";
import LegalDisclaimerBanner from "@/components/marketing/LegalDisclaimerBanner";

type Block = { type: "p"; text: string } | { type: "ul"; items: string[] };
type Section = { heading: string; blocks: Block[] };

const richTags = {
  privacyLink: (chunks: React.ReactNode) => <Link href="/privacy" className="underline hover:text-foreground">{chunks}</Link>,
  contactLink: (chunks: React.ReactNode) => <Link href="/contact" className="underline hover:text-foreground">{chunks}</Link>,
  mailLink: (chunks: React.ReactNode) => <a href="mailto:legal@markaestro.com" className="underline hover:text-foreground">{chunks}</a>,
};

export default function TermsPage() {
  const t = useTranslations("terms");
  const sections = t.raw("sections") as Section[];

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-3xl px-5 sm:px-6 py-14 lg:py-20">
        <LegalDisclaimerBanner englishHref="/terms" />
        <p className="mk-eyebrow">{t("eyebrow")}</p>
        <h1
          className="mt-2 text-[32px] sm:text-[36px] font-semibold leading-[1.1] text-foreground"
        >
          {t("title")}
        </h1>
        <p
          className="mt-2 font-mono text-[11.5px]  text-muted-foreground"
        >
          {t("lastUpdated")}
        </p>

        <div
          className="mt-10 flex flex-col gap-8 text-[14px] leading-relaxed text-mk-ink-80"
        >
          {sections.map((section, sectionIndex) => (
            <section key={section.heading}>
              <h2 className="text-[17px] font-semibold text-foreground tracking-[-0.01em]">{section.heading}</h2>
              <div className="mt-3 space-y-2">
                {section.blocks.map((block, blockIndex) =>
                  block.type === "ul" ? (
                    <ul key={blockIndex} className="list-disc space-y-1 ps-6">
                      {(t.raw(`sections.${sectionIndex}.blocks.${blockIndex}.items`) as string[]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={blockIndex}>
                      {t.rich(`sections.${sectionIndex}.blocks.${blockIndex}.text`, richTags)}
                    </p>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </MarketingLayout>
  );
}
