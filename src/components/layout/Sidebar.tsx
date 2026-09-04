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
import { useIntelligencePreviewAccess } from "@/hooks/useIntelligencePreviewAccess";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronsUpDown,
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
    Repeat,
} from "lucide-react";

export const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/analytics": BarChart3,
  "/intelligence": BrainCircuit,
  "/products": Package,
  "/content": LayoutGrid,
  "/calendar": Calendar,
  "/evergreen": Repeat,
  "/settings": Settings,
  "/guides/channels": BookOpen,
};

export function isNavActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  rail,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  rail: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      prefetch={false}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-2.5 rounded-lg text-[13.5px] font-medium transition-colors duration-150",
        rail ? "w-9 justify-center" : "px-2.5",
        active
          ? "bg-mk-accent-soft text-mk-accent"
          : "text-mk-ink-80 hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active ? "text-mk-accent" : "text-mk-ink-60 group-hover:text-foreground",
        )}
        strokeWidth={active ? 2 : 1.75}
      />
      {rail ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
    </Link>
  );
  if (!rail) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Grouped navigation list shared by the desktop sidebar and the mobile
 * drawer. `rail` collapses it to icons with tooltips.
 */
export function SidebarNav({
  rail = false,
  onNavigate,
  className,
}: {
  rail?: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const t = useTranslations("shell.nav");
  const canAccessIntelligence = useIntelligencePreviewAccess();
  const navGroups = navigationGroupsForUser(user?.email, user?.uid, canAccessIntelligence);

  return (
    <nav className={cn("flex flex-col gap-5", className)} aria-label={t("navigationMenu")}>
      {navGroups.map((group) => (
        <div key={group.id} className={cn("flex flex-col gap-0.5", rail && "items-center")}>
          {rail ? null : (
            <p className="mk-label mb-1 px-2.5">{t(`groups.${group.id}`)}</p>
          )}
          {group.items.map((item) => (
            <NavLink
              key={item.id}
              href={item.href}
              label={t(`items.${item.id}`)}
              icon={NAV_ICONS[item.href] ?? Home}
              active={isNavActive(pathname, item.href)}
              rail={rail}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

export function WorkspaceMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md bg-primary font-mono text-[10.5px] font-semibold text-primary-foreground",
        className,
      )}
      aria-hidden
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function WorkspaceSwitcher({ rail = false }: { rail?: boolean }) {
  const t = useTranslations("shell.nav");
  const { workspaces, current, switchWorkspace } = useWorkspace();
  if (!current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={rail ? current.name : undefined}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg border border-border bg-card text-start transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none",
            rail ? "size-9 justify-center" : "w-full px-2.5 py-2",
          )}
        >
          <WorkspaceMark name={current.name} />
          {rail ? null : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-4 text-foreground">{current.name}</span>
                <span className="mt-0.5 block text-[11px] capitalize leading-4 text-muted-foreground">{current.role}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-mk-ink-40 group-hover:text-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={rail ? "right" : "bottom"} className="w-60">
        <DropdownMenuLabel className="mk-label">{t("workspaceSwitcher.yourWorkspaces")}</DropdownMenuLabel>
        {workspaces.map((ws) => (
          <DropdownMenuItem
            key={ws.id}
            onClick={() => switchWorkspace(ws.id)}
            className="flex items-center gap-2.5 py-2"
          >
            <WorkspaceMark name={ws.name} className={ws.id === current.id ? undefined : "bg-muted text-mk-ink-80"} />
            <span className="flex-1 truncate text-[13px] font-medium">{ws.name}</span>
            {ws.id === current.id ? <Check className="size-4 text-foreground" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=workspaces" prefetch={false} className="text-[13px] text-mk-ink-80">
            {t("workspaceSwitcher.manageWorkspaces")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-foreground ring-1 ring-border",
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/**
 * Desktop navigation. Full 240px column at `xl`, a 64px icon rail at `lg`,
 * hidden below (the header drawer and tab bar take over).
 */
export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const t = useTranslations("shell.nav");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { status: subscriptionStatus } = useSubscription();
  const rail = !useMediaQuery("(min-width: 1280px)", true);
  const tier = subscriptionStatus?.tier ?? null;
  const planBadge = tier && tier !== "free" ? tier : null;

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const email = user?.email ?? "";

  return (
    <aside
      className={cn(
        "sticky top-0 z-20 hidden h-dvh w-16 shrink-0 select-none flex-col border-e border-border bg-card lg:flex xl:w-60",
        className,
      )}
    >
      <div className={cn("flex h-14 items-center", rail ? "justify-center" : "gap-2.5 px-4")}>
        <Image
          src="/markaestro-logo-transparent.png"
          alt="Markaestro"
          width={24}
          height={24}
          className="size-6 object-contain"
        />
        {rail ? null : (
          <span className="flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
            Markaestro
            {planBadge ? (
              <span className="rounded-md bg-muted px-1.5 py-px text-[10.5px] font-medium capitalize text-mk-ink-80">
                {planBadge}
              </span>
            ) : null}
          </span>
        )}
      </div>

      <div className={cn("pb-3", rail ? "flex justify-center" : "px-3")}>
        <WorkspaceSwitcher rail={rail} />
      </div>

      <div className={cn("flex-1 overflow-y-auto py-2", rail ? "px-3.5" : "px-3")}>
        <SidebarNav rail={rail} />
      </div>

      <div className={cn("flex flex-col gap-1 border-t border-border py-3", rail ? "items-center px-3.5" : "px-3")}>
        <NavLink
          href={settingsItem.href}
          label={t("items.settings")}
          icon={Settings}
          active={pathname === settingsItem.href}
          rail={rail}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={displayName}
              className={cn(
                "mt-1 flex items-center gap-2.5 rounded-lg text-start outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40",
                rail ? "size-9 justify-center" : "w-full px-1.5 py-1.5",
              )}
            >
              <UserAvatar name={displayName} className={rail ? "size-7" : undefined} />
              {rail ? null : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-4 text-foreground">{displayName}</span>
                  <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">{email}</span>
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side={rail ? "right" : "top"} className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-[13px] font-medium text-foreground">{displayName}</span>
              {email ? <span className="block truncate text-[11.5px] text-muted-foreground">{email}</span> : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" prefetch={false}>{t("items.settings")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setTimeout(() => setLogoutOpen(true), 0)}>
              <LogOut />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <LogoutConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen} onConfirm={logout} />
    </aside>
  );
}
