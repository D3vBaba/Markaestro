"use client";

import { usePathname } from "next/navigation";
import { Search, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { navigationGroups, settingsItem } from "@/lib/nav";
import { useAuth } from "@/components/providers/AuthProvider";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function Header() {
    const pathname = usePathname();
    const { user, logout } = useAuth();

    const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
    const email = user?.email || "";
    const initials = (user?.displayName || user?.email?.split("@")[0] || "U")
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

    return (
        <header className="sticky top-0 z-30 flex h-20 items-center gap-4 border-b bg-background px-6">
            {/* Mobile menu */}
            <Sheet>
                <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0 lg:hidden rounded-xl">
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle navigation menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] sm:w-[340px] p-0 border-r border-border/30 bg-sidebar">
                    <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                    <SheetDescription className="sr-only">Main navigation links</SheetDescription>
                    <div className="flex flex-col h-full p-6">
                        <div className="font-bold text-lg mb-10 flex items-center gap-3 text-sidebar-accent-foreground">
                            <Image src="/markaestro-logo-transparent.png" alt="Markaestro" width={36} height={32} className="object-contain invert" />
                            Markaestro
                        </div>
                        <div className="space-y-7">
                            {navigationGroups.map((group) => (
                                <div key={group.group}>
                                    <p className="px-4 mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/40">
                                        {group.group}
                                    </p>
                                    <div className="space-y-1">
                                        {group.items.map((item) => (
                                            <Link
                                                key={item.name}
                                                href={item.href}
                                                className={cn(
                                                    "flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200",
                                                    pathname === item.href
                                                        ? "bg-primary text-white"
                                                        : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
                                                )}
                                            >
                                                {item.name}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <div className="border-t border-sidebar-border pt-4">
                                <Link
                                    href={settingsItem.href}
                                    className={cn(
                                        "flex items-center px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200",
                                        pathname === settingsItem.href
                                            ? "bg-primary text-white"
                                            : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
                                    )}
                                >
                                    {settingsItem.name}
                                </Link>
                            </div>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            <div className="flex-1" />

            {/* Search + User menu */}
            <div className="flex items-center gap-3">
                <div className="relative hidden md:flex items-center">
                    <Search className="absolute left-3.5 h-3.5 w-3.5 text-muted-foreground/60" />
                    <Input
                        type="search"
                        placeholder="Search anything..."
                        className="w-[240px] lg:w-[320px] rounded-xl bg-muted/40 border-transparent pl-10 h-10 text-sm focus-visible:ring-primary/20 focus-visible:bg-background focus-visible:border-primary/30"
                    />
                    <kbd className="pointer-events-none absolute right-3 hidden h-5 select-none items-center gap-1 rounded-md border border-border/60 bg-muted/60 px-1.5 font-mono text-[10px] font-medium text-muted-foreground/70 sm:flex">
                        <span className="text-xs">&#8984;</span>K
                    </kbd>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0">
                            <Avatar className="h-10 w-10 bg-primary">
                                <AvatarFallback className="text-sm bg-transparent text-white font-semibold">{initials}</AvatarFallback>
                            </Avatar>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56 rounded-xl" align="end" forceMount>
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col space-y-1">
                                <p className="text-sm font-medium leading-none">{displayName}</p>
                                {email && <p className="text-xs leading-none text-muted-foreground">{email}</p>}
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
                            className="text-rose-600 focus:text-rose-600 focus:bg-rose-50 cursor-pointer"
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
