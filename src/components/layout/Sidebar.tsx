"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigationGroups, settingsItem } from "@/lib/nav";
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
  TrendingUp,
  Settings,
  type LucideIcon,
} from "lucide-react";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/products": Package,
  "/content": LayoutGrid,
  "/calendar": Calendar,
  "/analytics": TrendingUp,
  "/settings": Settings,
};

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { workspaces, current, switchWorkspace } = useWorkspace();

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const handle = user?.email ? `@${user.email.split("@")[0]}` : "";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col h-screen sticky top-0 shrink-0 border-r",
        className,
      )}
      style={{
        width: 232,
        background: "var(--mk-paper)",
        borderColor: "var(--mk-rule)",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Image
          src="/markaestro-logo-transparent.png"
          alt="Markaestro"
          width={26}
          height={26}
          className="object-contain"
        />
        <span
          className="font-semibold text-[15px] tracking-tight"
          style={{ color: "var(--mk-ink)", letterSpacing: "-0.015em" }}
        >
          Markaestro
        </span>
      </div>

      {/* Workspace switcher */}
      {workspaces.length > 0 && current && (
        <div className="px-3 pb-3.5 border-b" style={{ borderColor: "var(--mk-rule)" }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-mk-panel"
                style={{ border: "1px solid var(--mk-rule)", background: "var(--mk-paper)" }}
              >
                <div
                  className="h-6 w-6 rounded-[5px] grid place-items-center shrink-0 font-mono text-[11px] font-semibold"
                  style={{
                    background: "var(--mk-accent)",
                    color: "var(--mk-accent-ink)",
                  }}
                >
                  {current.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[12.5px] font-medium leading-tight truncate"
                    style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                  >
                    {current.name}
                  </p>
                  <p
                    className="text-[10px] mt-0.5 capitalize"
                    style={{ color: "var(--mk-ink-40)", letterSpacing: "-0.005em" }}
                  >
                    {current.role}
                  </p>
                </div>
                <ChevronDown className="h-3 w-3 shrink-0" style={{ color: "var(--mk-ink-40)" }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
                Your workspaces
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {workspaces.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => switchWorkspace(ws.id)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-primary">
                      {ws.name.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <span className="flex-1 truncate text-sm">{ws.name}</span>
                  {ws.id === current.id && (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings?tab=workspaces" className="cursor-pointer text-sm">
                  Manage workspaces
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-4 flex flex-col gap-3.5">
        {navigationGroups.map((group) => (
          <div key={group.group}>
            <p
              className="px-2.5 pb-1.5 font-mono text-[9px] uppercase"
              style={{
                color: "var(--mk-ink-40)",
                letterSpacing: "0.2em",
              }}
            >
              {group.group}
            </p>
            <div className="flex flex-col gap-px">
              {group.items.map((item) => {
                const Icon = NAV_ICONS[item.href] ?? Home;
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] transition-colors",
                      isActive ? "font-medium" : "font-normal",
                    )}
                    style={{
                      background: isActive ? "var(--mk-panel)" : "transparent",
                      color: isActive ? "var(--mk-ink)" : "var(--mk-ink-80)",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    <Icon
                      className="h-[15px] w-[15px] shrink-0"
                      style={{ color: isActive ? "var(--mk-ink)" : "var(--mk-ink-60)" }}
                    />
                    <span className="whitespace-nowrap">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: settings + user tile */}
      <div
        className="border-t px-2.5 py-3 flex flex-col gap-0.5"
        style={{ borderColor: "var(--mk-rule)" }}
      >
        <Link
          href={settingsItem.href}
          className={cn(
            "flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] transition-colors",
            pathname === settingsItem.href ? "font-medium" : "font-normal",
          )}
          style={{
            background: pathname === settingsItem.href ? "var(--mk-panel)" : "transparent",
            color: "var(--mk-ink-80)",
            letterSpacing: "-0.005em",
          }}
        >
          <Settings className="h-[15px] w-[15px]" style={{ color: "var(--mk-ink-60)" }} />
          <span>Settings</span>
        </Link>

        <div
          className="mt-2 flex items-center gap-2.5 px-2.5 pt-2.5 pb-1 border-t"
          style={{ borderColor: "var(--mk-rule-soft)" }}
        >
          <div
            className="h-7 w-7 rounded-full grid place-items-center font-mono text-[11px] font-semibold shrink-0"
            style={{
              background: "var(--mk-accent)",
              color: "var(--mk-accent-ink)",
            }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[12.5px] font-medium leading-tight truncate"
              style={{ color: "var(--mk-ink)" }}
            >
              {displayName}
            </p>
            <p
              className="text-[10.5px] leading-tight truncate"
              style={{ color: "var(--mk-ink-40)" }}
            >
              {handle}
            </p>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Log out"
            className="text-[10.5px] whitespace-nowrap shrink-0 px-1.5 py-1 rounded hover:text-mk-neg transition-colors"
            style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
          >
            log out
          </button>
        </div>
      </div>
    </aside>
  );
}
