"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigationGroups, settingsItem } from "@/lib/nav";
import { useAuth } from "@/components/providers/AuthProvider";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

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
        <div className={cn("hidden lg:flex flex-col w-64 bg-sidebar h-screen sticky top-0", className)}>
            {/* Brand */}
            <div className="px-6 pt-8 pb-8">
                <div className="flex items-center gap-3">
                    <Image src="/markaestro-logo-transparent.png" alt="Markaestro" width={36} height={32} className="object-contain invert" />
                    <span className="font-bold text-lg tracking-tight text-sidebar-accent-foreground">Markaestro</span>
                </div>
            </div>

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
                                            "flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200",
                                            isActive
                                                ? "bg-primary text-white"
                                                : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
                                        )}
                                    >
                                        <div className={cn(
                                            "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                                            isActive
                                                ? "bg-white/20"
                                                : "bg-sidebar-accent"
                                        )}>
                                            <item.icon className="w-3.5 h-3.5" />
                                        </div>
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
                        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 mb-3",
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
                        size="icon"
                        className="h-7 w-7 text-sidebar-foreground/40 hover:text-rose-400 hover:bg-rose-500/10"
                        onClick={logout}
                    >
                        <LogOut className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
