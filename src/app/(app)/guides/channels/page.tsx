"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Info } from "lucide-react";


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

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-5 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
      <div className="pb-4 border-b border-slate-100 dark:border-slate-800/80 mb-4">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 m-0">{title}</h3>
        {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 m-0">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default function ConnectChannelsGuidePage() {
  const t = useTranslations("guidesChannels");

  return (
    <>
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
      />

      <div className="grid gap-6">
        <div className="rounded-2xl p-5 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200/50 dark:border-blue-800/50 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400">
              <Info className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 m-0">{t("intro.title")}</h3>
          </div>

          <p className="text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            {t("intro.body")}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-1">
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-800/30">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
                {t("intro.layer1Badge")}
              </span>
              <p className="mt-2.5 text-xs font-bold text-slate-900 dark:text-slate-100">{t("intro.layer1Title")}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t.rich("intro.layer1Body", { bold: (chunks) => <strong>{chunks}</strong> })}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-800/30">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
                {t("intro.layer2Badge")}
              </span>
              <p className="mt-2.5 text-xs font-bold text-slate-900 dark:text-slate-100">{t("intro.layer2Title")}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t("intro.layer2Body")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border p-3.5 bg-amber-50/80 dark:bg-amber-950/30 border-amber-200/80 dark:border-amber-900/50">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200 m-0">
              {t.rich("intro.warning", { bold: (chunks) => <strong>{chunks}</strong> })}
            </p>
          </div>
        </div>

        {CHANNEL_GUIDES.map((guide) => (
          <SectionCard
            key={guide.id}
            title={t(`guides.${guide.id}.label`)}
            description={t(`guides.${guide.id}.scope`)}
          >
            <ol className="space-y-3.5">
              {Array.from({ length: guide.stepCount }, (_, index) => (
                <li key={index} className="flex items-start gap-3.5">
                  <span className="h-6 w-6 shrink-0 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200/50 dark:border-blue-800/50 text-blue-600 dark:text-blue-400 font-bold font-mono text-xs flex items-center justify-center shadow-2xs">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                      {t(`guides.${guide.id}.steps.${index}.title`)}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {t(`guides.${guide.id}.steps.${index}.detail`)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {guide.hasGotcha && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/20 p-3 mt-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300 m-0">
                  {t(`guides.${guide.id}.gotcha`)}
                </p>
              </div>
            )}
          </SectionCard>
        ))}

        <SectionCard title={t("troubleshooting.title")}>
          <div className="space-y-4">
            {Array.from({ length: TROUBLESHOOTING_COUNT }, (_, index) => (
              <div key={index} className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-800/30">
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {t(`troubleshooting.items.${index}.q`)}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400 m-0">
                  {t(`troubleshooting.items.${index}.a`)}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
            {t.rich("troubleshooting.manageFrom", {
              brands: (chunks) => (
                <Link href="/products" className="underline underline-offset-2 text-blue-600 dark:text-blue-400 font-semibold">
                  {chunks}
                </Link>
              ),
              settings: (chunks) => (
                <Link href="/settings?tab=integrations" className="underline underline-offset-2 text-blue-600 dark:text-blue-400 font-semibold">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </SectionCard>

        <div className="flex items-center justify-between gap-4 rounded-2xl p-5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40">
          <div>
            <p className="text-xs font-bold text-blue-950 dark:text-blue-100">{t("footer.ready")}</p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">{t("footer.goToProducts")}</p>
          </div>
          <Link href="/products">
            <Button className="rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs">
              {t("footer.action")}
            </Button>
          </Link>
        </div>
      </div>

    </>
  );
}

