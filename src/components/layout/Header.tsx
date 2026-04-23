"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  Menu,
  Home,
  Package,
  Target,
  LayoutGrid,
  Calendar,
  TrendingUp,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { navigationGroups, settingsItem } from "@/lib/nav";
import { useAuth } from "@/components/providers/AuthProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { cn } from "@/lib/utils";
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
  "/products": Package,
  "/campaigns": Target,
  "/content": LayoutGrid,
  "/calendar": Calendar,
  "/analytics": TrendingUp,
  "/settings": SettingsIcon,
};

export function Header() {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { current: workspace } = useWorkspace();

    const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
    const email = user?.email || "";
    const handle = user?.email ? `@${user.email.split("@")[0]}` : "";
    const initials = displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

    return (
        <header
            className="sticky top-0 z-30 flex items-center gap-3 border-b px-4 sm:px-6"
            style={{
                height: 60,
                background: "var(--mk-paper)",
                borderColor: "var(--mk-rule)",
            }}
        >
            {/* Mobile: logo + menu trigger (left) */}
            <Sheet>
                <SheetTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 lg:hidden rounded-lg h-10 w-10"
                    >
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle navigation menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent
                    side="left"
                    className="w-[288px] sm:w-[308px] p-0 flex flex-col"
                    style={{ background: "var(--mk-paper)", borderColor: "var(--mk-rule)" }}
                >
                    <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                    <SheetDescription className="sr-only">Main navigation links</SheetDescription>

                    {/* Brand */}
                    <div className="flex items-center gap-2.5 px-4 pt-5 pb-3">
                        <Image
                            src="/markaestro-logo-transparent.png"
                            alt="Markaestro"
                            width={26}
                            height={26}
                            className="object-contain"
                        />
                        <span
                            className="font-semibold text-[15px]"
                            style={{ color: "var(--mk-ink)", letterSpacing: "-0.015em" }}
                        >
                            Markaestro
                        </span>
                    </div>

                    {/* Workspace chip */}
                    {workspace && (
                        <div
                            className="px-3 pb-3.5 border-b"
                            style={{ borderColor: "var(--mk-rule)" }}
                        >
                            <div
                                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2"
                                style={{
                                    border: "1px solid var(--mk-rule)",
                                    background: "var(--mk-paper)",
                                }}
                            >
                                <div
                                    className="h-6 w-6 rounded-[5px] grid place-items-center shrink-0 font-mono text-[11px] font-semibold"
                                    style={{
                                        background: "var(--mk-accent)",
                                        color: "var(--mk-accent-ink)",
                                    }}
                                >
                                    {workspace.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p
                                        className="text-[12.5px] font-medium leading-tight truncate"
                                        style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                                    >
                                        {workspace.name}
                                    </p>
                                    <p
                                        className="text-[10px] mt-0.5 capitalize"
                                        style={{ color: "var(--mk-ink-40)" }}
                                    >
                                        {workspace.role}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Nav groups */}
                    <nav className="flex-1 overflow-y-auto px-2.5 py-4 flex flex-col gap-3.5">
                        {navigationGroups.map((group) => (
                            <div key={group.group}>
                                <p
                                    className="px-2.5 pb-1.5 font-mono text-[9px] uppercase"
                                    style={{ color: "var(--mk-ink-40)", letterSpacing: "0.2em" }}
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
                                                    "flex items-center gap-2.5 rounded-[7px] px-2.5 py-2.5 text-[14px]",
                                                    isActive ? "font-medium" : "font-normal",
                                                )}
                                                style={{
                                                    background: isActive ? "var(--mk-panel)" : "transparent",
                                                    color: isActive ? "var(--mk-ink)" : "var(--mk-ink-80)",
                                                    letterSpacing: "-0.005em",
                                                }}
                                            >
                                                <Icon
                                                    className="h-4 w-4 shrink-0"
                                                    style={{ color: isActive ? "var(--mk-ink)" : "var(--mk-ink-60)" }}
                                                />
                                                <span>{item.name}</span>
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
                            className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-2.5 text-[14px]"
                            style={{
                                background: pathname === settingsItem.href ? "var(--mk-panel)" : "transparent",
                                color: "var(--mk-ink-80)",
                                letterSpacing: "-0.005em",
                            }}
                        >
                            <SettingsIcon className="h-4 w-4" style={{ color: "var(--mk-ink-60)" }} />
                            <span>{settingsItem.name}</span>
                        </Link>
                        <div
                            className="mt-2 flex items-center gap-2.5 px-2.5 pt-2.5 pb-1 border-t"
                            style={{ borderColor: "var(--mk-rule-soft)" }}
                        >
                            <div
                                className="h-8 w-8 rounded-full grid place-items-center font-mono text-[11px] font-semibold shrink-0"
                                style={{
                                    background: "var(--mk-accent)",
                                    color: "var(--mk-accent-ink)",
                                }}
                            >
                                {initials}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p
                                    className="text-[13px] font-medium leading-tight truncate"
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
                                className="shrink-0 text-[11px] whitespace-nowrap px-2 py-1 rounded"
                                style={{ color: "var(--mk-ink-60)" }}
                            >
                                log out
                            </button>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            {/* Mobile: inline logo so header isn't empty on small screens */}
            <div className="flex items-center gap-2 lg:hidden">
                <Image
                    src="/markaestro-logo-transparent.png"
                    alt="Markaestro"
                    width={22}
                    height={22}
                    className="object-contain"
                />
                <span
                    className="font-semibold text-[14px]"
                    style={{ color: "var(--mk-ink)", letterSpacing: "-0.015em" }}
                >
                    Markaestro
                </span>
            </div>

            <div className="flex-1" />

            {/* Search + Avatar */}
            <div className="flex items-center gap-2.5">
                <div
                    className="hidden md:flex items-center gap-2 px-3 h-[34px] rounded-lg w-full md:w-[260px] lg:w-[320px]"
                    style={{
                        border: "1px solid var(--mk-rule)",
                        background: "var(--mk-surface)",
                    }}
                >
                    <Search className="h-3.5 w-3.5" style={{ color: "var(--mk-ink-40)" }} />
                    <input
                        type="search"
                        placeholder="Search anything..."
                        className="flex-1 bg-transparent border-none outline-none text-[12.5px]"
                        style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                    />
                    <span
                        className="font-mono text-[9.5px] px-1.5 py-px rounded"
                        style={{
                            color: "var(--mk-ink-40)",
                            border: "1px solid var(--mk-rule)",
                            letterSpacing: "0.04em",
                        }}
                    >
                        {"⌘K"}
                    </span>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="h-9 w-9 md:h-8 md:w-8 rounded-full grid place-items-center font-mono text-[11px] font-semibold cursor-pointer"
                            style={{
                                background: "var(--mk-accent)",
                                color: "var(--mk-accent-ink)",
                                border: "none",
                            }}
                        >
                            {initials}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56 rounded-lg" align="end" forceMount>
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col space-y-1">
                                <p className="text-sm font-medium leading-none">{displayName}</p>
                                {email && (
                                    <p className="text-xs leading-none text-muted-foreground">{email}</p>
                                )}
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <Link href="/settings" className="cursor-pointer">
                                Settings
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="cursor-pointer"
                            style={{ color: "var(--mk-neg)" }}
                            onClick={logout}
                        >
                            Sign out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
