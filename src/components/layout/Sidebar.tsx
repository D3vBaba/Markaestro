"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigationGroups, settingsItem } from "@/lib/nav";
import { useAuth } from "@/components/providers/AuthProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Check } from "lucide-react";

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { workspaces, current, switchWorkspace } = useWorkspace();

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className={cn("hidden lg:flex flex-col w-64 bg-sidebar h-screen sticky top-0", className)}>
      {/* Brand */}
      <div className="px-6 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <Image src="/markaestro-logo-transparent.png" alt="Markaestro" width={36} height={32} className="object-contain invert" />
          <span className="font-bold text-lg tracking-tight text-sidebar-accent-foreground">Markaestro</span>
        </div>
      </div>

      {/* Workspace Switcher */}
      {workspaces.length > 0 && current && (
        <div className="px-3 pb-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-sidebar-accent transition-colors text-left">
                <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <span className="text-[11px] font-bold text-primary">
                    {current.name.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium leading-none truncate text-sidebar-accent-foreground">
                    {current.name}
                  </p>
                  <p className="text-[10px] text-sidebar-foreground/40 mt-0.5 capitalize">{current.role}</p>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-sidebar-foreground/40 shrink-0" />
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
      <div className="flex-1 px-3 py-2 space-y-7 overflow-y-auto">
        {navigationGroups.map((group) => (
          <div key={group.group}>
            <p className="px-4 mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/40">
              {group.group}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "flex items-center px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200",
                      isActive
                        ? "bg-primary text-white"
                        : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
                    )}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 mt-auto border-t border-sidebar-border">
        <Link
          href={settingsItem.href}
          className={cn(
            "flex items-center px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 mb-3",
            pathname === settingsItem.href
              ? "bg-primary text-white"
              : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
          )}
        >
          {settingsItem.name}
        </Link>
        <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-sidebar-accent transition-colors">
          <Avatar className="h-9 w-9 border border-sidebar-border bg-primary">
            <AvatarFallback className="text-xs bg-transparent text-white font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-none truncate text-sidebar-accent-foreground">{displayName}</p>
            <p className="text-[11px] text-sidebar-foreground/50 truncate pt-1">{email}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-sidebar-foreground/40 hover:text-rose-400 hover:bg-rose-500/10"
            onClick={logout}
          >
            Log out
          </Button>
        </div>
      </div>
    </div>
  );
}
