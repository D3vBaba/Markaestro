"use client";

import { usePathname } from "next/navigation";
import { Bell, Search, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "./Sidebar"; // Reuse specific logic or parts if needed, but for mobile we might just render navigation list
import { navigation, currentUser } from "@/lib/mock-data";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Header() {
    const pathname = usePathname();
    const currentRoute = navigation.find(n => n.href === pathname)?.name || "Dashboard";

    return (
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border/40 bg-background/90 backdrop-blur-xl px-6 supports-[backdrop-filter]:bg-background/60">
            <Sheet>
                <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="shrink-0 lg:hidden rounded-lg">
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle navigation menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] sm:w-[350px] p-0 border-r border-border/40">
                    {/* Mobile Sidebar Logic roughly duplicated or imported if refactored */}
                    <div className="flex flex-col h-full bg-background/90 backdrop-blur-xl p-6">
                        <div className="font-bold text-2xl mb-8 flex items-center gap-3">
                            <div className="w-9 h-9 rounded-md border bg-white p-1 flex items-center justify-center overflow-hidden">
                                <Image src="/markaestro-logo.jpg" alt="Markaestro" width={28} height={28} className="object-contain" />
                            </div>
                            Markaestro
                        </div>
                        <div className="space-y-1">
                            {navigation.map((item) => (
                                <Link
                                    key={item.name}
                                    href={item.href}
                                    className={cn(
                                        "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors",
                                        pathname === item.href
                                            ? "bg-primary text-primary-foreground shadow-md"
                                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                    )}
                                >
                                    <item.icon className="w-5 h-5" />
                                    {item.name}
                                </Link>
                            ))}
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            <div className="w-full flex-1 min-w-0">
                <h1 className="truncate text-lg font-semibold text-foreground md:text-xl">{currentRoute}</h1>
            </div>

            <div className="flex items-center gap-4">
                <div className="relative hidden md:block w-96">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search campaigns, contacts, automations..."
                        className="w-full rounded-lg bg-background pl-8 md:w-[200px] lg:w-[320px] focus-visible:ring-primary/20"
                    />
                </div>
                <Button variant="ghost" size="icon" className="rounded-full relative">
                    <Bell className="h-5 w-5 text-muted-foreground" />
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary animate-ping" />
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                </Button>
                <Avatar className="h-8 w-8 md:hidden">
                    <AvatarImage src={currentUser.avatar} />
                    <AvatarFallback>AM</AvatarFallback>
                </Avatar>
            </div>
        </header>
    );
}
