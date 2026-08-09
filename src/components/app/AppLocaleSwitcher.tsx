"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { routing, LOCALE_LABELS, type AppLocale } from "@/i18n/routing";
import { apiPut } from "@/lib/api-client";
import Select from "@/components/app/Select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * (app)-tree locale switcher. Unlike the marketing LocaleSwitcher, this
 * can't swap locale via a URL prefix — the (app) tree isn't locale-routed.
 * Instead it persists the choice to the member doc and asks the server
 * layout to re-resolve it via router.refresh().
 *
 * `variant="card"` (default) is the full Settings → Account row. `variant=
 * "compact"` is a header-sized Globe icon + dropdown, mirroring the
 * marketing LocaleSwitcher's look so the picker is reachable from every
 * app page, not just Settings.
 */
export default function AppLocaleSwitcher({
  variant = "card",
}: {
  variant?: "card" | "compact";
}) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("shell.localeSwitcher");
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function handleChange(next: AppLocale) {
    if (next === locale || saving) return;
    setSaving(true);
    try {
      const res = await apiPut("/api/settings/locale", { locale: next });
      if (!res.ok) throw new Error("locale update failed");
      router.refresh();
    } catch {
      toast.error(t("error"));
    } finally {
      setSaving(false);
    }
  }

  if (variant === "compact") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg"
            aria-label={t("label")}
            disabled={saving}
          >
            <Globe className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70vh] overflow-y-auto">
          {routing.locales.map((code) => (
            <DropdownMenuItem
              key={code}
              onSelect={() => handleChange(code)}
              className={code === locale ? "font-medium" : undefined}
              data-active={code === locale}
            >
              {LOCALE_LABELS[code]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{t("label")}</p>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <Select
        value={locale}
        disabled={saving}
        onChange={(e) => handleChange(e.target.value as AppLocale)}
        className="sm:max-w-[200px]"
        aria-label={t("label")}
      >
        {routing.locales.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </Select>
    </div>
  );
}
