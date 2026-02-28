"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigation } from "@/lib/nav";
import { useAuth } from "@/components/providers/AuthProvider";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export function Sidebar({ className }: { className?: string }) {
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
        <div className={cn("hidden lg:flex flex-col w-64 border-r border-border bg-sidebar h-screen sticky top-0", className)}>
            <div className="p-8">
                <div className="flex items-center gap-3 font-semibold text-xl tracking-tight text-foreground">
                    <div className="w-9 h-9 rounded-md border bg-white flex items-center justify-center shadow-sm overflow-hidden p-1">
                        <Image src="/markaestro-logo.jpg" alt="Markaestro" width={28} height={28} className="object-contain" />
                    </div>
                    Markaestro
                </div>
            </div>

            <div className="flex-1 px-4 py-2 space-y-1">
                {navigation.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                                isActive
                                    ? "text-primary-foreground bg-primary shadow-sm"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                        >
                            <item.icon className={cn("w-4 h-4", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                            {item.name}
                        </Link>
                    );
                })}
            </div>

            <div className="p-4 mt-auto">
                <Separator className="mb-4 bg-border" />
                <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <Avatar className="h-8 w-8 border border-border">
                        <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-none truncate">{displayName}</p>
                        <p className="text-xs text-muted-foreground truncate pt-1">{email}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={logout}>
                        <LogOut className="w-3 h-3" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
