"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Globe } from "lucide-react";
import { routing, LOCALE_LABELS, type AppLocale } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Swaps locale on the CURRENT page rather than bouncing to the homepage —
 * router.replace(pathname, { locale }) re-resolves the as-needed prefix
 * (bare for en, /xx for the rest) for wherever the visitor already is.
 */
export default function LocaleSwitcher() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("common.localeSwitcher");
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  function switchTo(next: AppLocale) {
    router.replace(
      // @ts-expect-error -- pathname is typed against next-intl's Pathnames
      // config, which this app doesn't use (plain string routes only).
      { pathname, params },
      { locale: next },
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          aria-label={t("label")}
        >
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] overflow-y-auto">
        {routing.locales.map((code) => (
          <DropdownMenuItem
            key={code}
            onSelect={() => switchTo(code)}
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
