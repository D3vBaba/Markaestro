"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  Menu,
  Home,
  Package,
  LayoutGrid,
  Calendar,
  Settings as SettingsIcon,
  type LucideIcon,
  BookOpen,
  BrainCircuit,
  BarChart3,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { navigationGroupsForUser, settingsItem } from "@/lib/nav";
import { CommandPalette } from "@/components/app/CommandPalette";
import LogoutConfirmDialog from "@/components/app/LogoutConfirmDialog";
import AppLocaleSwitcher from "@/components/app/AppLocaleSwitcher";
import InboxMenu from "@/components/layout/InboxMenu";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/providers/AuthProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { cn } from "@/lib/utils";
import { isRtlLocale } from "@/i18n/routing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/analytics": BarChart3,
  "/intelligence": BrainCircuit,
  "/products": Package,
  "/content": LayoutGrid,
  "/calendar": Calendar,
  "/settings": SettingsIcon,
  "/guides/channels": BookOpen,
};

export function Header() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const t = useTranslations("shell.nav");
  const tHeader = useTranslations("shell.header");
  const isRtl = isRtlLocale(useLocale());
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { current: workspace, workspaces, switchWorkspace } = useWorkspace();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const navGroups = navigationGroupsForUser(user?.email, user?.uid);
  const handle = user?.email ? `@${user.email.split("@")[0]}` : "";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200/80 dark:border-slate-800/80 px-4 sm:px-8 h-15 backdrop-blur-md bg-white/80 dark:bg-slate-900/80">
      {/* Mobile: logo + menu trigger (left) */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden rounded-xl h-9 w-9 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">{t("toggleMenu")}</span>
          </Button>
        </SheetTrigger>
        <SheetContent
          side={isRtl ? "right" : "left"}
          className="w-[288px] sm:w-[308px] p-0 flex flex-col bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
        >
          <SheetTitle className="sr-only">{t("navigationMenu")}</SheetTitle>
          <SheetDescription className="sr-only">{t("navigationMenuDescription")}</SheetDescription>

          {/* Brand */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-3">
            <Image
              src="/markaestro-logo-transparent.png"
              alt="Markaestro"
              width={28}
              height={28}
              className="h-7 w-7 object-contain"
            />
            <span className="font-bold text-[15px] tracking-tight text-slate-900 dark:text-slate-50">
              Markaestro
            </span>
          </div>

          {/* Workspace switcher */}
          {workspace && (
            <div className="px-3 pb-3 border-b border-slate-100 dark:border-slate-800/60">
              <div className="grid gap-1">
                {(workspaces.length > 0 ? workspaces : [workspace]).map((ws) => {
                  const active = ws.id === workspace.id;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => { if (!active) switchWorkspace(ws.id); }}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                        active
                          ? "bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/50 dark:border-blue-800/40"
                          : "hover:bg-slate-100/60 dark:hover:bg-slate-800/40 border border-transparent opacity-75",
                      )}
                    >
                      <div className="h-6 w-6 rounded-lg bg-blue-600 text-white font-bold font-mono text-[10px] flex items-center justify-center shrink-0">
                        {ws.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-medium leading-tight truncate text-slate-900 dark:text-slate-100">
                          {ws.name}
                        </p>
                        <p className="text-[10px] text-slate-400 capitalize mt-0.5">
                          {ws.role}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Nav groups */}
          <nav className="flex-1 overflow-y-auto px-3 py-3.5 flex flex-col gap-3.5">
            {navGroups.map((group) => (
              <div key={group.id}>
                <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {t(`groups.${group.id}`)}
                </p>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const Icon = NAV_ICONS[item.href] ?? Home;
                    const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        prefetch={false}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[13.5px] font-medium transition-colors",
                          isActive
                            ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400"
                            : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-slate-500",
                          )}
                        />
                        <span className="flex-1">{t(`items.${item.id}`)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer: settings + user tile */}
          <div className="border-t border-slate-100 dark:border-slate-800 p-3 flex flex-col gap-1">
            <Link
              href={settingsItem.href}
              prefetch={false}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
            >
              <SettingsIcon className="h-4 w-4 text-slate-400" />
              <span>{t("items.settings")}</span>
            </Link>
            <div className="mt-1 flex items-center gap-2.5 px-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
              <div className="h-8 w-8 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate text-slate-900 dark:text-slate-100">
                  {displayName}
                </p>
                <p className="text-[10.5px] truncate text-slate-400">
                  {handle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogoutOpen(true)}
                aria-label={t("signOut")}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 hover:text-rose-500 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t("signOut")}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile: inline logo so header isn't empty on small screens */}
      <div className="flex items-center gap-2.5 lg:hidden">
        <Image
          src="/markaestro-logo-transparent.png"
          alt="Markaestro"
          width={24}
          height={24}
          className="h-6 w-6 object-contain"
        />
        <span className="font-bold text-[14px] text-slate-900 dark:text-slate-50">
          Markaestro
        </span>
      </div>

      <div className="flex-1" />

      {/* Search + Locale Switcher + Avatar */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="hidden md:flex items-center gap-2.5 px-3 h-9 rounded-xl w-[240px] lg:w-[280px] cursor-pointer text-start bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-2xs group"
        >
          <Search className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
          <span className="flex-1 text-[12.5px] text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
            {tHeader("searchPlaceholder")}
          </span>
          <kbd className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 dark:text-slate-500 shadow-2xs">
            ⌘K
          </kbd>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden shrink-0 rounded-xl h-9 w-9 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => setPaletteOpen(true)}
        >
          <Search className="h-4 w-4" />
          <span className="sr-only">{tHeader("search")}</span>
        </Button>

        <InboxMenu />
        <AppLocaleSwitcher variant="compact" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-8 w-8 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center cursor-pointer ring-2 ring-transparent hover:ring-blue-200 dark:hover:ring-blue-900 transition-shadow"
            >
              {initials}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal py-2">
              <div className="flex flex-col space-y-1">
                <p className="text-xs font-semibold leading-none text-slate-900 dark:text-slate-100">{displayName}</p>
                {email && (
                  <p className="text-[11px] leading-none text-slate-400 truncate">{email}</p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer text-xs font-medium">
                {t("items.settings")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-xs font-medium text-rose-600 dark:text-rose-400 focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/50"
              onSelect={() => {
                setTimeout(() => setLogoutOpen(true), 0);
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <LogoutConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen} onConfirm={logout} />
    </header>
  );
}

