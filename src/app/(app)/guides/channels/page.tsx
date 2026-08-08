"use client";

import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pillStyle } from "@/components/mk/pills";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

type Step = { title: string; detail: string };

type ChannelGuide = {
  id: string;
  label: string;
  scope: string;
  steps: Step[];
  gotcha?: string;
};

/**
 * Facebook is deliberately first and most detailed: its permission model is the
 * one that surprises people, because the grant is account-wide while the Page
 * choice is per brand.
 */
const CHANNEL_GUIDES: ChannelGuide[] = [
  {
    id: "meta",
    label: "Facebook",
    scope: "One Facebook login covers your whole workspace. Each brand then picks its own Page.",
    steps: [
      {
        title: "Open a brand and press Connect on Facebook",
        detail:
          "Brands → pick a brand → Channels. It does not matter which brand you start from; the login applies to every brand.",
      },
      {
        title: "Tick every Page you want Markaestro to manage",
        detail:
          "Facebook's dialog is the permission list. Whatever you tick becomes the complete set Markaestro may touch, and it replaces the previous set. A Page you leave unticked loses access immediately.",
      },
      {
        title: "Choose which Page this brand posts to",
        detail:
          "Back in Markaestro, use Choose Pages. This is routing, not permission — each brand can point at its own Page, and one brand can hold several.",
      },
    ],
    gotcha:
      "Ticking only one Page in Facebook's dialog will disconnect every other brand's Page. Always tick them all, then narrow per brand inside Markaestro.",
  },
  {
    id: "instagram",
    label: "Instagram",
    scope: "Connected per brand, using Instagram's own login rather than Facebook's.",
    steps: [
      {
        title: "Press Connect on Instagram in the brand's Channels tab",
        detail: "This is separate from Facebook — linking a Facebook Page does not link its Instagram account.",
      },
      {
        title: "Log in with the Instagram account itself",
        detail: "The account must be a Professional (Business or Creator) account. Personal accounts cannot publish through the API.",
      },
    ],
    gotcha:
      "If Instagram refuses the login, the account is almost certainly still a personal account. Switch it to Professional in the Instagram app, then reconnect.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    scope: "Connected per brand. TikTok requires you to finish each post in their app.",
    steps: [
      {
        title: "Press Connect on TikTok and authorize",
        detail: "Markaestro uploads the video and sends it to your TikTok inbox.",
      },
      {
        title: "Finish the post in the TikTok app",
        detail:
          "TikTok does not allow full publishing from outside their app. When a post reaches your inbox we email you, and the post sits in To Post until you confirm.",
      },
    ],
    gotcha: "A TikTok post is not live until you open the TikTok app and publish it. The email is your prompt.",
  },
  {
    id: "threads",
    label: "Threads",
    scope: "Connected per brand, using its own login.",
    steps: [
      { title: "Press Connect on Threads", detail: "Authorize with the Threads account you want to post from." },
    ],
  },
  {
    id: "pinterest",
    label: "Pinterest",
    scope: "Connected per brand. Boards work like Facebook Pages — pick which one this brand pins to.",
    steps: [
      { title: "Press Connect on Pinterest", detail: "Authorize the Pinterest business account." },
      {
        title: "Choose a board",
        detail: "Pins need a destination board. You can link several boards to one brand and choose between them when composing.",
      },
    ],
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    scope: "Connected per brand, as either a personal profile or a company Page.",
    steps: [
      {
        title: "Choose Profile or Pages when connecting",
        detail: "They are separate authorizations. Connect both if you post as yourself and as the company.",
      },
      { title: "Pick the destination", detail: "Select which profile or company Page this brand publishes to." },
    ],
  },
];

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
  return (
    <AppShell>
      <PageHeader
        title="Connecting channels"
        subtitle="How permissions and brands fit together, and the exact steps for each platform."
      />

      <div className="grid gap-5">
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 shrink-0" style={{ color: "var(--mk-ink-60)" }} />
              <CardTitle className="text-[15px]">The one thing to understand first</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              Connecting a channel is two separate things, and mixing them up is what breaks posting.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/50 p-3.5">
                <Badge className="border-0 text-[10px]" style={pillStyle("warn")}>
                  Layer 1 · Permission
                </Badge>
                <p className="mt-2 text-[13px] font-medium">What the platform lets us touch</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  Set in the platform&apos;s own dialog when you log in. On Facebook this covers your{" "}
                  <strong>whole workspace</strong>, and each new login <strong>replaces</strong> the previous
                  selection.
                </p>
              </div>
              <div className="rounded-xl border border-border/50 p-3.5">
                <Badge className="border-0 text-[10px]" style={pillStyle("pos")}>
                  Layer 2 · Routing
                </Badge>
                <p className="mt-2 text-[13px] font-medium">Which account this brand posts to</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  Set inside Markaestro, per brand. This is where &ldquo;one Page per brand&rdquo; lives — and a
                  brand can hold several accounts if you want.
                </p>
              </div>
            </div>

            <div
              className="flex gap-2.5 rounded-xl border p-3.5"
              style={{ borderColor: "var(--mk-warn)", background: "color-mix(in srgb, var(--mk-warn) 8%, transparent)" }}
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--mk-warn)" }} />
              <p className="text-[12.5px] leading-relaxed">
                <strong>Grant everything, then narrow per brand.</strong> In the platform dialog tick every account
                you might ever post to. Choosing just one there revokes the rest, and their scheduled posts start
                failing.
              </p>
            </div>
          </CardContent>
        </Card>

        {CHANNEL_GUIDES.map((guide) => (
          <SectionCard key={guide.id} title={guide.label} description={guide.scope}>
            <ol className="space-y-2.5">
              {guide.steps.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span
                    className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
                    style={{ background: "var(--mk-panel)", color: "var(--mk-ink)" }}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{step.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">
                      {step.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {guide.gotcha && (
              <div className="flex gap-2.5 rounded-lg border border-border/50 p-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--mk-warn)" }} />
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">{guide.gotcha}</p>
              </div>
            )}
          </SectionCard>
        ))}

        <SectionCard
          title="If something stops working"
          description="What each message means and the quickest way out."
        >
          <dl className="space-y-3">
            {[
              {
                q: "A brand says “Reconnect Facebook and tick this Page”",
                a: "Facebook's current permissions no longer include that Page — usually because a later login ticked fewer Pages. Reconnect from any brand and tick every Page. Nothing is lost; the brand's Page choice is restored automatically.",
              },
              {
                q: "A brand says “Pick it again in brand settings”",
                a: "The Page is still granted but its token needs reissuing. Open the brand's Channels tab and select the Page again.",
              },
              {
                q: "Scheduled posts are failing",
                a: "Check the brand's Channels tab first. If every channel looks connected, reconnect the platform and tick all accounts — a narrowed permission set is the most common cause.",
              },
              {
                q: "A TikTok post never went live",
                a: "TikTok posts must be finished in the TikTok app. Check your email for the prompt, or open To Post in Markaestro.",
              },
            ].map((item) => (
              <div key={item.q}>
                <dt className="flex gap-2 text-[13px] font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--mk-ink-60)" }} />
                  {item.q}
                </dt>
                <dd className="ml-5.5 mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{item.a}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[12.5px] text-muted-foreground">
            Manage every connection from{" "}
            <Link href="/products" className="underline underline-offset-2">
              Brands
            </Link>{" "}
            or{" "}
            <Link href="/settings?tab=integrations" className="underline underline-offset-2">
              Settings → Integrations
            </Link>
            .
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
