"use client";

import { usePathname } from "next/navigation";
import { Bell, Search, Menu } from "lucide-react";
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

    const allItems = [...navigationGroups.flatMap((g) => g.items), settingsItem];

    return (
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border/60 bg-background/80 backdrop-blur-xl px-6">
            <Sheet>
                <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="shrink-0 lg:hidden rounded-lg">
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle navigation menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] sm:w-[350px] p-0 border-r border-border/40">
                    <div className="flex flex-col h-full bg-background p-6">
                        <div className="font-bold text-xl mb-8 flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg border bg-white p-1 flex items-center justify-center overflow-hidden">
                                <Image src="/markaestro-logo.jpg" alt="Markaestro" width={28} height={28} className="object-contain" />
                            </div>
                            Markaestro
                        </div>
                        <div className="space-y-6">
                            {navigationGroups.map((group) => (
                                <div key={group.group}>
                                    <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                                        {group.group}
                                    </p>
                                    <div className="space-y-0.5">
                                        {group.items.map((item) => (
                                            <Link
                                                key={item.name}
                                                href={item.href}
                                                className={cn(
                                                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                                                    pathname === item.href
                                                        ? "text-foreground bg-accent-soft border-l-2 border-primary pl-[10px]"
                                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                )}
                                            >
                                                <item.icon className="w-4 h-4" />
                                                {item.name}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <div className="border-t pt-3">
                                <Link
                                    href={settingsItem.href}
                                    className={cn(
                                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                                        pathname === settingsItem.href
                                            ? "text-foreground bg-accent-soft border-l-2 border-primary pl-[10px]"
                                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                    )}
                                >
                                    <settingsItem.icon className="w-4 h-4" />
                                    {settingsItem.name}
                                </Link>
                            </div>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            <div className="flex-1" />

            <div className="flex items-center gap-3">
                <div className="relative hidden md:flex items-center">
                    <Search className="absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search..."
                        className="w-[240px] lg:w-[320px] rounded-lg bg-muted/50 border-transparent pl-9 h-9 text-sm focus-visible:ring-primary/20 focus-visible:bg-background focus-visible:border-border"
                    />
                    <kbd className="pointer-events-none absolute right-2.5 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
                        <span className="text-xs">&#8984;</span>K
                    </kbd>
                </div>
                <Button variant="ghost" size="icon" className="rounded-full relative h-9 w-9">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary animate-ping" />
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
                </Button>
                <Avatar className="h-8 w-8 md:hidden">
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
            </div>
        </header>
    );
}
