"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Search, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { navigationGroups, settingsItem } from "@/lib/nav";
import { useAuth } from "@/components/providers/AuthProvider";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Header() {
    const pathname = usePathname();
    const { user, logout } = useAuth();

    const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
    const email = user?.email || "";
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
            {/* Mobile menu trigger */}
            <Sheet>
                <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0 lg:hidden rounded-lg">
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle navigation menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent
                    side="left"
                    className="w-[300px] sm:w-[320px] p-0"
                    style={{ background: "var(--mk-paper)", borderColor: "var(--mk-rule)" }}
                >
                    <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                    <SheetDescription className="sr-only">Main navigation links</SheetDescription>
                    <div className="flex flex-col h-full p-5">
                        <div className="flex items-center gap-2.5 mb-6">
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
                        <div className="flex flex-col gap-4">
                            {navigationGroups.map((group) => (
                                <div key={group.group}>
                                    <p
                                        className="px-2.5 pb-1.5 font-mono text-[9px] uppercase"
                                        style={{ color: "var(--mk-ink-40)", letterSpacing: "0.2em" }}
                                    >
                                        {group.group}
                                    </p>
                                    <div className="flex flex-col gap-px">
                                        {group.items.map((item) => (
                                            <Link
                                                key={item.name}
                                                href={item.href}
                                                className={cn(
                                                    "rounded-[7px] px-2.5 py-2 text-[13px] transition-colors",
                                                    pathname === item.href ? "font-medium" : "font-normal",
                                                )}
                                                style={{
                                                    background: pathname === item.href ? "var(--mk-panel)" : "transparent",
                                                    color: pathname === item.href ? "var(--mk-ink)" : "var(--mk-ink-80)",
                                                    letterSpacing: "-0.005em",
                                                }}
                                            >
                                                {item.name}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <div className="border-t pt-3" style={{ borderColor: "var(--mk-rule)" }}>
                                <Link
                                    href={settingsItem.href}
                                    className="rounded-[7px] px-2.5 py-2 text-[13px] block"
                                    style={{
                                        background: pathname === settingsItem.href ? "var(--mk-panel)" : "transparent",
                                        color: pathname === settingsItem.href ? "var(--mk-ink)" : "var(--mk-ink-80)",
                                        letterSpacing: "-0.005em",
                                    }}
                                >
                                    {settingsItem.name}
                                </Link>
                            </div>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            <div className="flex-1" />

            {/* Search + Avatar */}
            <div className="flex items-center gap-2.5">
                <div
                    className="hidden md:flex items-center gap-2 px-3 h-[34px] rounded-lg"
                    style={{
                        width: 320,
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
                            className="h-8 w-8 rounded-full grid place-items-center font-mono text-[11px] font-semibold cursor-pointer"
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
