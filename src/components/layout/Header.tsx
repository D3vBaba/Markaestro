"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, Menu, LogOut, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CommandPalette } from "@/components/app/CommandPalette";
import LogoutConfirmDialog from "@/components/app/LogoutConfirmDialog";
import AppLocaleSwitcher from "@/components/app/AppLocaleSwitcher";
import InboxMenu from "@/components/layout/InboxMenu";
import { SidebarNav, UserAvatar, WorkspaceSwitcher } from "@/components/layout/Sidebar";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/providers/AuthProvider";
import { isRtlLocale } from "@/i18n/routing";

export function Header() {
  const { user, logout } = useAuth();
  const t = useTranslations("shell.nav");
  const tHeader = useTranslations("shell.header");
  const isRtl = isRtlLocale(useLocale());
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";

  return (
    <header className="mk-glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-6 lg:px-8">
      {/* Mobile: navigation drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("toggleMenu")}>
            <Menu className="size-5" strokeWidth={1.75} />
          </Button>
        </SheetTrigger>
        <SheetContent side={isRtl ? "right" : "left"} className="w-[288px] gap-0 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">{t("navigationMenu")}</SheetTitle>
          <SheetDescription className="sr-only">{t("navigationMenuDescription")}</SheetDescription>

          <div className="flex h-14 items-center gap-2.5 px-4">
            <Image
              src="/markaestro-logo-transparent.png"
              alt="Markaestro"
              width={24}
              height={24}
              className="size-6 object-contain"
            />
            <span className="text-[14px] font-semibold tracking-tight text-foreground">Markaestro</span>
          </div>

          <div className="px-3 pb-3">
            <WorkspaceSwitcher />
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </div>

          <div className="flex flex-col gap-1 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Link
              href="/settings"
              prefetch={false}
              onClick={() => setDrawerOpen(false)}
              className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium text-mk-ink-80 hover:bg-muted hover:text-foreground"
            >
              <SettingsIcon className="size-4 text-mk-ink-60" strokeWidth={1.75} />
              {t("items.settings")}
            </Link>
            <div className="mt-1 flex items-center gap-2.5 px-1.5 py-1.5">
              <UserAvatar name={displayName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-4 text-foreground">{displayName}</span>
                <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">{email}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("signOut")}
                onClick={() => {
                  setDrawerOpen(false);
                  setTimeout(() => setLogoutOpen(true), 0);
                }}
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Link href="/dashboard" prefetch={false} className="flex items-center gap-2 lg:hidden">
        <Image
          src="/markaestro-logo-transparent.png"
          alt="Markaestro"
          width={22}
          height={22}
          className="size-[22px] object-contain"
        />
        <span className="text-[14px] font-semibold tracking-tight text-foreground">Markaestro</span>
      </Link>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="hidden h-8 w-56 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-start text-[13px] text-mk-ink-60 transition-colors hover:border-mk-ink-20 hover:text-foreground md:flex lg:w-64"
        >
          <Search className="size-3.5 shrink-0 text-mk-ink-40" />
          <span className="flex-1 truncate">{tHeader("searchPlaceholder")}</span>
          <kbd className="rounded-md border border-border bg-muted px-1.5 font-mono text-[10.5px] leading-4 text-mk-ink-60">
            ⌘K
          </kbd>
        </button>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setPaletteOpen(true)} aria-label={tHeader("search")}>
          <Search className="size-[18px]" strokeWidth={1.75} />
        </Button>

        <InboxMenu />
        <AppLocaleSwitcher variant="compact" />

      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <LogoutConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen} onConfirm={logout} />
    </header>
  );
}
