"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import LogoutConfirmDialog from "@/components/app/LogoutConfirmDialog";
import { cn } from "@/lib/utils";
import { navigationGroupsForUser, settingsItem } from "@/lib/nav";
import { useAuth } from "@/components/providers/AuthProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  Check,
  Home,
  Package,
  LayoutGrid,
  Calendar,
  Settings,
  BookOpen,
  BrainCircuit,
  BarChart3,
  LogOut,
  type LucideIcon,
} from "lucide-react";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/analytics": BarChart3,
  "/intelligence": BrainCircuit,
  "/products": Package,
  "/content": LayoutGrid,
  "/calendar": Calendar,
  "/settings": Settings,
  "/guides/channels": BookOpen,
};

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const t = useTranslations("shell.nav");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { workspaces, current, switchWorkspace } = useWorkspace();

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const handle = user?.email ? `@${user.email.split("@")[0]}` : "";
  const navGroups = navigationGroupsForUser(user?.email, user?.uid);
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col h-dvh sticky top-0 shrink-0 border-r border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 z-20 select-none",
        className,
      )}
      style={{ width: 240 }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <Image
          src="/markaestro-logo-transparent.png"
          alt="Markaestro"
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
        />
        <div className="flex flex-col">
          <span className="font-bold text-[15px] tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-1.5">
            Markaestro
            <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 text-[9.5px] font-semibold text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60">
              PRO
            </span>
          </span>
        </div>
      </div>

      {/* Workspace switcher */}
      {workspaces.length > 0 && current && (
        <div className="px-3 pb-3 pt-1 border-b border-slate-100 dark:border-slate-800/60">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-start transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-800/30 group cursor-pointer"
              >
                <div className="h-6 w-6 rounded-lg bg-blue-600 dark:bg-blue-500 text-white flex items-center justify-center shrink-0 font-mono text-[11px] font-bold shadow-xs">
                  {current.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium leading-tight truncate text-slate-800 dark:text-slate-200">
                    {current.name}
                  </p>
                  <p className="text-[10.5px] text-slate-400 dark:text-slate-500 capitalize leading-tight mt-0.5">
                    {current.role}
                  </p>
                </div>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                {t("workspaceSwitcher.yourWorkspaces")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {workspaces.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => switchWorkspace(ws.id)}
                  className="flex items-center gap-2.5 cursor-pointer rounded-lg py-2"
                >
                  <div className="h-6 w-6 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold text-[10px] flex items-center justify-center shrink-0 border border-blue-200/50 dark:border-blue-800/50">
                    {ws.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200">{ws.name}</span>
                  {ws.id === current.id && (
                    <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings?tab=workspaces" prefetch={false} className="cursor-pointer text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
                  {t("workspaceSwitcher.manageWorkspaces")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3.5 flex flex-col gap-4">
        {navGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
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
                      "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors duration-150 relative",
                      isActive
                        ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300",
                      )}
                    />
                    <span className="whitespace-nowrap flex-1">{t(`items.${item.id}`)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: settings + user tile */}
      <div className="border-t border-slate-100 dark:border-slate-800/60 p-2.5 flex flex-col gap-1.5 bg-slate-50/40 dark:bg-slate-950/40">
        <Link
          href={settingsItem.href}
          prefetch={false}
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors",
            pathname === settingsItem.href
              ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100",
          )}
        >
          <Settings className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          <span>{t("items.settings")}</span>
        </Link>

        <div className="flex items-center gap-2.5 rounded-xl p-2 bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800/70 shadow-xs">
          <div className="h-8 w-8 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] font-semibold leading-tight truncate text-slate-900 dark:text-slate-100">
              {displayName}
            </p>
            <p className="text-[10.5px] leading-tight truncate text-slate-400 dark:text-slate-500 mt-0.5">
              {handle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLogoutOpen(true)}
            title={t("signOut")}
            aria-label={t("signOut")}
            className="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>


      <LogoutConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen} onConfirm={logout} />
    </aside>
  );
}

