"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/app/PageHeader";
import Section from "@/components/app/Section";
import Notice from "@/components/app/Notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

type ChannelGuideMeta = {
  id: string;
  stepCount: number;
  hasGotcha: boolean;
};

/**
 * Facebook is deliberately first and most detailed: its permission model is the
 * one that surprises people, because the grant is account-wide while the Page
 * choice is per brand.
 */
const CHANNEL_GUIDES: ChannelGuideMeta[] = [
  { id: "meta", stepCount: 3, hasGotcha: true },
  { id: "instagram", stepCount: 2, hasGotcha: true },
  { id: "tiktok", stepCount: 2, hasGotcha: true },
  { id: "threads", stepCount: 1, hasGotcha: false },
  { id: "pinterest", stepCount: 2, hasGotcha: false },
  { id: "linkedin", stepCount: 2, hasGotcha: false },
];

const TROUBLESHOOTING_COUNT = 4;

export default function ConnectChannelsGuidePage() {
  const t = useTranslations("guidesChannels");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <div className="space-y-8">
        <Section title={t("intro.title")} bordered contentClassName="p-4 sm:p-5">
          <p className="m-0 text-sm leading-6 text-mk-ink-80 text-pretty">{t("intro.body")}</p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/60 p-4">
              <Badge variant="warning">{t("intro.layer1Badge")}</Badge>
              <p className="m-0 mt-2 text-sm font-semibold text-foreground">{t("intro.layer1Title")}</p>
              <p className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">
                {t.rich("intro.layer1Body", { bold: (chunks) => <strong className="font-medium text-foreground">{chunks}</strong> })}
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 p-4">
              <Badge variant="positive">{t("intro.layer2Badge")}</Badge>
              <p className="m-0 mt-2 text-sm font-semibold text-foreground">{t("intro.layer2Title")}</p>
              <p className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">{t("intro.layer2Body")}</p>
            </div>
          </div>

          <Notice tone="warning" icon={AlertTriangle} className="mt-4">
            {t.rich("intro.warning", { bold: (chunks) => <strong className="font-medium text-foreground">{chunks}</strong> })}
          </Notice>
        </Section>

        {CHANNEL_GUIDES.map((guide) => (
          <Section
            key={guide.id}
            title={t(`guides.${guide.id}.label`)}
            description={t(`guides.${guide.id}.scope`)}
            bordered
            contentClassName="p-4 sm:p-5"
          >
            <ol className="m-0 grid list-none gap-4 p-0">
              {Array.from({ length: guide.stepCount }, (_, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 shrink-0 font-mono text-xs tabular-nums text-mk-ink-40">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {t(`guides.${guide.id}.steps.${index}.title`)}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">
                      {t(`guides.${guide.id}.steps.${index}.detail`)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {guide.hasGotcha && (
              <Notice tone="warning" icon={AlertTriangle} className="mt-4">
                {t(`guides.${guide.id}.gotcha`)}
              </Notice>
            )}
          </Section>
        ))}

        <Section title={t("troubleshooting.title")} bordered>
          <dl className="m-0 divide-y divide-border">
            {Array.from({ length: TROUBLESHOOTING_COUNT }, (_, index) => (
              <div key={index} className="px-4 py-4 sm:px-5">
                <dt className="text-sm font-medium text-foreground">{t(`troubleshooting.items.${index}.q`)}</dt>
                <dd className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">{t(`troubleshooting.items.${index}.a`)}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 border-t border-border px-4 py-3 text-[13px] leading-5 text-muted-foreground sm:px-5">
            {t.rich("troubleshooting.manageFrom", {
              brands: (chunks) => (
                <Link href="/products" className="font-medium text-mk-accent underline-offset-4 hover:underline">
                  {chunks}
                </Link>
              ),
              settings: (chunks) => (
                <Link href="/settings?tab=integrations" className="font-medium text-mk-accent underline-offset-4 hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </Section>

        <Notice
          tone="neutral"
          title={t("footer.ready")}
          action={
            <Button asChild>
              <Link href="/products">{t("footer.action")}</Link>
            </Button>
          }
        >
          {t("footer.goToProducts")}
        </Notice>
      </div>
    </div>
  );
}
