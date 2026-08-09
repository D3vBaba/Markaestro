"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import MarketingLayout from "@/components/layout/MarketingLayout";
import LegalDisclaimerBanner from "@/components/marketing/LegalDisclaimerBanner";

type Block =
  | { type: "p"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] };
type Section = { heading: string; blocks: Block[] };

const richTags = {
  strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
  contactLink: (chunks: React.ReactNode) => <Link href="/contact" className="underline hover:text-foreground">{chunks}</Link>,
  mailLink: (chunks: React.ReactNode) => <a href="mailto:legal@markaestro.com" className="underline hover:text-foreground">{chunks}</a>,
};

export default function PrivacyPage() {
  const t = useTranslations("privacy");
  const sections = t.raw("sections") as Section[];

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-3xl px-5 sm:px-6 py-14 lg:py-20">
        <LegalDisclaimerBanner englishHref="/privacy" />
        <p className="mk-eyebrow">{t("eyebrow")}</p>
        <h1
          className="mt-2 text-[32px] sm:text-[36px] font-semibold leading-[1.1]"
          style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
        >
          {t("title")}
        </h1>
        <p
          className="mt-2 font-mono text-[11.5px] uppercase"
          style={{ color: "var(--mk-ink-40)", letterSpacing: "0.08em" }}
        >
          {t("lastUpdated")}
        </p>

        <div
          className="mt-10 flex flex-col gap-8 text-[14px] leading-relaxed"
          style={{ color: "var(--mk-ink-80)" }}
        >
          {sections.map((section, sectionIndex) => (
            <section key={section.heading}>
              <h2 className="text-[17px] font-semibold text-foreground tracking-[-0.01em]">{section.heading}</h2>
              <div className="mt-3">
                {section.blocks.map((block, blockIndex) => {
                  const path = `sections.${sectionIndex}.blocks.${blockIndex}`;
                  if (block.type === "h3") {
                    return (
                      <h3 key={blockIndex} className="mt-4 font-medium text-foreground">
                        {t(`${path}.text`)}
                      </h3>
                    );
                  }
                  if (block.type === "ul") {
                    return (
                      <ul key={blockIndex} className="mt-2 list-disc space-y-1 ps-6">
                        {block.items.map((_, itemIndex) => (
                          <li key={itemIndex}>{t.rich(`${path}.items.${itemIndex}`, richTags)}</li>
                        ))}
                      </ul>
                    );
                  }
                  return <p key={blockIndex} className={blockIndex === 0 ? undefined : "mt-2"}>{t.rich(`${path}.text`, richTags)}</p>;
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </MarketingLayout>
  );
}
