"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";

type ChannelStatusRow = {
  channel: string;
  label: string;
  state: "ready" | "needs_setup" | "disconnected";
  reason: string | null;
  /** Accounts linked for this channel. Empty means never connected. */
  destinations: unknown[];
  tokenExchangeDegraded?: boolean;
};

/**
 * Persistent warning when a connected channel cannot publish.
 *
 * The integration status machine has modelled `connected` / `expired` /
 * `revoked` / `error` since it was written, and nothing told a user their
 * Instagram token had died until they tried to publish. For a scheduled post
 * that means finding out after the publish window has passed.
 *
 * This is the passive half of that fix, and it needs no new endpoint:
 * `/api/social/channels` already computes exactly this for preflight. The
 * active half (an email when a scheduled post in the next 24 hours targets a
 * broken channel) lives in `lib/channel-health-emails.ts`.
 *
 * Only channels that are set up and have gone wrong are shown. A channel the
 * workspace has simply never connected is not a problem, it is a choice, and
 * nagging about it would train people to ignore the banner that matters.
 */
export function ChannelHealthBanner() {
  const t = useTranslations("shell.channelHealthBanner");
  const { current: currentWorkspace } = useWorkspace();
  const { data } = useApiQuery<{ channels: ChannelStatusRow[] }>(
    currentWorkspace ? "/api/social/channels" : null,
    { wsId: currentWorkspace?.id },
  );

  const channels = data?.channels ?? [];
  // "Set up and gone wrong", not "not set up". A channel with no linked
  // account reports `disconnected` too, and nagging about a channel the
  // workspace never chose to connect would train people to ignore the banner
  // that matters. The destination list is what separates the two.
  const broken = channels.filter(
    (channel) => channel.destinations?.length > 0 && channel.state !== "ready",
  );
  const degraded = channels.filter(
    (channel) => channel.destinations?.length > 0 && channel.tokenExchangeDegraded,
  );
  if (broken.length === 0 && degraded.length === 0) return null;

  const names = (rows: ChannelStatusRow[]) =>
    rows.map((row) => row.label).join(", ");

  return (
    <div
      className="border-b"
      style={{ background: "color-mix(in oklch, var(--mk-warn) 10%, var(--mk-paper))" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 sm:px-6 py-2.5 text-[13px]">
        <span className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">
            {broken.length > 0
              ? // One broken channel gets its own reason, which is the whole
                // point: "Instagram is not ready: token expired" is
                // actionable and "1 channel needs attention" is not.
                broken.length === 1
                ? t("single", {
                    channel: broken[0].label,
                    reason: broken[0].reason || t("genericReason"),
                  })
                : t("multiple", { channels: names(broken) })
              : t("degraded", { channels: names(degraded) })}
          </span>
        </span>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/settings?tab=integrations">{t("reconnect")}</Link>
        </Button>
      </div>
    </div>
  );
}
