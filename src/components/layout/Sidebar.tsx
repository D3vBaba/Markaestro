"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigation, currentUser } from "@/lib/mock-data";
import { LayoutDashboard, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export function Sidebar({ className }: { className?: string }) {
    const pathname = usePathname();

    return (
        <div className={cn("hidden lg:flex flex-col w-64 border-r border-border bg-sidebar h-screen sticky top-0", className)}>
            <div className="p-8">
                <div className="flex items-center gap-3 font-semibold text-xl tracking-tight text-foreground">
                    <div className="w-8 h-8 rounded-sm bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                        <LayoutDashboard className="w-5 h-5" />
                    </div>
                    Maerkestro
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
                        <AvatarImage src={currentUser.avatar} alt={currentUser.name} />
                        <AvatarFallback>AM</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-none truncate">{currentUser.name}</p>
                        <p className="text-xs text-muted-foreground truncate pt-1">{currentUser.email}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                        <LogOut className="w-3 h-3" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
