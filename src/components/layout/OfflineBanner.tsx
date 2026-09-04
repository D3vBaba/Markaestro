"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { ShellBanner } from "./ShellBanner";
import { useTranslations } from "next-intl";
import { onOfflineChange } from "@/lib/api-client";

/**
 * One persistent banner while requests are not landing, instead of a toast
 * per failed action: ten failed toasts during a network drop is worse than
 * one banner, and the toasts bury the errors that are actually about the
 * user's work.
 *
 * Driven by the api-client's own connectivity view (`navigator.onLine` plus
 * the failed-request heuristic), so it also shows when the browser believes
 * it is online but requests are failing at the transport.
 */
export function OfflineBanner() {
  const t = useTranslations("shell.offlineBanner");
  const [offline, setOffline] = useState(false);

  useEffect(() => onOfflineChange(setOffline), []);

  if (!offline) return null;

  return (
    <ShellBanner tone="neutral" icon={WifiOff} role="status">
      {t("message")}
    </ShellBanner>
  );
}
