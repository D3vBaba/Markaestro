"use client";

import { usePathname } from "next/navigation";
import { Search, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { navigationGroups, settingsItem } from "@/lib/nav";
import { useAuth } from "@/components/providers/AuthProvider";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function Header() {
    const pathname = usePathname();
    const { user } = useAuth();

    const initials = (user?.displayName || user?.email?.split("@")[0] || "U")
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

    return (
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-6">
            {/* Mobile menu */}
            <Sheet>
                <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0 lg:hidden rounded-xl">
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle navigation menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] sm:w-[340px] p-0 border-r border-border/30 bg-sidebar">
                    <div className="flex flex-col h-full p-6">
                        <div className="font-bold text-lg mb-10 flex items-center gap-3 text-sidebar-accent-foreground">
                            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center overflow-hidden p-1.5">
                                <Image src="/markaestro-logo.jpg" alt="Markaestro" width={28} height={28} className="object-contain rounded-md" />
                            </div>
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
                                                <div className={cn(
                                                    "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                                                    pathname === item.href ? "bg-white/20" : "bg-sidebar-accent"
                                                )}>
                                                    <item.icon className="w-3.5 h-3.5" />
                                                </div>
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
                                        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200",
                                        pathname === settingsItem.href
                                            ? "bg-primary text-white"
                                            : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
                                    )}
                                >
                                    <div className={cn(
                                        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                                        pathname === settingsItem.href ? "bg-white/20" : "bg-sidebar-accent"
                                    )}>
                                        <settingsItem.icon className="w-3.5 h-3.5" />
                                    </div>
                                    {settingsItem.name}
                                </Link>
                            </div>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            <div className="flex-1" />

            {/* Search */}
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
                <Avatar className="h-9 w-9 md:hidden bg-primary">
                    <AvatarFallback className="text-xs bg-transparent text-white font-semibold">{initials}</AvatarFallback>
                </Avatar>
            </div>
        </header>
    );
}
