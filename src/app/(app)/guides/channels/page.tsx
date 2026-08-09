"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pillStyle } from "@/components/mk/pills";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

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
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px]">{title}</CardTitle>
        {description && <CardDescription className="text-[13px]">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export default function ConnectChannelsGuidePage() {
  const t = useTranslations("guidesChannels");

  return (
    <AppShell>
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
      />

      <div className="grid gap-5">
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 shrink-0" style={{ color: "var(--mk-ink-60)" }} />
              <CardTitle className="text-[15px]">{t("intro.title")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              {t("intro.body")}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/50 p-3.5">
                <Badge className="border-0 text-[10px]" style={pillStyle("warn")}>
                  {t("intro.layer1Badge")}
                </Badge>
                <p className="mt-2 text-[13px] font-medium">{t("intro.layer1Title")}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {t.rich("intro.layer1Body", { bold: (chunks) => <strong>{chunks}</strong> })}
                </p>
              </div>
              <div className="rounded-xl border border-border/50 p-3.5">
                <Badge className="border-0 text-[10px]" style={pillStyle("pos")}>
                  {t("intro.layer2Badge")}
                </Badge>
                <p className="mt-2 text-[13px] font-medium">{t("intro.layer2Title")}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {t("intro.layer2Body")}
                </p>
              </div>
            </div>

            <div
              className="flex gap-2.5 rounded-xl border p-3.5"
              style={{ borderColor: "var(--mk-warn)", background: "color-mix(in srgb, var(--mk-warn) 8%, transparent)" }}
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--mk-warn)" }} />
              <p className="text-[12.5px] leading-relaxed">
                {t.rich("intro.warning", { bold: (chunks) => <strong>{chunks}</strong> })}
              </p>
            </div>
          </CardContent>
        </Card>

        {CHANNEL_GUIDES.map((guide) => (
          <SectionCard
            key={guide.id}
            title={t(`guides.${guide.id}.label`)}
            description={t(`guides.${guide.id}.scope`)}
          >
            <ol className="space-y-2.5">
              {Array.from({ length: guide.stepCount }, (_, index) => (
                <li key={index} className="flex gap-3">
                  <span
                    className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
                    style={{ background: "var(--mk-panel)", color: "var(--mk-ink)" }}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">
                      {t(`guides.${guide.id}.steps.${index}.title`)}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">
                      {t(`guides.${guide.id}.steps.${index}.detail`)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {guide.hasGotcha && (
              <div className="flex gap-2.5 rounded-lg border border-border/50 p-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--mk-warn)" }} />
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  {t(`guides.${guide.id}.gotcha`)}
                </p>
              </div>
            )}
          </SectionCard>
        ))}

        <SectionCard
          title={t("troubleshooting.title")}
          description={t("troubleshooting.subtitle")}
        >
          <dl className="space-y-3">
            {Array.from({ length: TROUBLESHOOTING_COUNT }, (_, index) => (
              <div key={index}>
                <dt className="flex gap-2 text-[13px] font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--mk-ink-60)" }} />
                  {t(`troubleshooting.items.${index}.q`)}
                </dt>
                <dd className="ms-5.5 mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {t(`troubleshooting.items.${index}.a`)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[12.5px] text-muted-foreground">
            {t.rich("troubleshooting.manageFrom", {
              brands: (chunks) => (
                <Link href="/products" className="underline underline-offset-2">
                  {chunks}
                </Link>
              ),
              settings: (chunks) => (
                <Link href="/settings?tab=integrations" className="underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
