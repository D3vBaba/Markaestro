"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Home,
  BarChart3,
  Package,
  LayoutGrid,
  Calendar,
  type LucideIcon,
} from "lucide-react";

const TABS: { id: string; href: string; icon: LucideIcon }[] = [
  { id: "home", href: "/dashboard", icon: Home },
  { id: "analytics", href: "/analytics", icon: BarChart3 },
  { id: "brands", href: "/products", icon: Package },
  { id: "posts", href: "/content", icon: LayoutGrid },
  { id: "calendar", href: "/calendar", icon: Calendar },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const t = useTranslations("shell.mobileTabBar");

  return (
    <nav
      className="z-20 shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label={t("home")}
    >
      <div className="grid h-14 grid-cols-5">
        {TABS.map((tab) => {
          const isActive =
            pathname === tab.href || (tab.href !== "/dashboard" && pathname.startsWith(tab.href + "/"));
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex select-none flex-col items-center justify-center gap-1 transition-colors active:bg-muted",
                isActive ? "text-mk-accent" : "text-mk-ink-60",
              )}
            >
              <Icon className="size-[22px]" strokeWidth={isActive ? 2.25 : 1.75} />
              <span className={cn("text-[10.5px] leading-3", isActive ? "font-semibold" : "font-medium")}>
                {t(tab.id)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
