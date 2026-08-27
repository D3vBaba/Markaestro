"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
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
      className="lg:hidden shrink-0 border-t border-slate-200/80 dark:border-slate-800/80 backdrop-blur-md bg-white/90 dark:bg-slate-900/90 z-20"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="grid grid-cols-5 py-1">
        {TABS.map((tab) => {
          const isActive =
            pathname === tab.href || (tab.href !== "/dashboard" && pathname.startsWith(tab.href + "/"));
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 min-h-[50px] select-none transition-colors relative ${
                isActive
                  ? "text-blue-600 dark:text-blue-400 font-semibold"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Icon
                className="h-5 w-5"
                strokeWidth={isActive ? 2.2 : 1.75}
              />
              <span className="text-[10px] tracking-tight">
                {t(tab.id)}
              </span>
              {isActive && (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-blue-600 dark:bg-blue-400" />
              )}
            </Link>

          );
        })}
      </div>
    </nav>
  );
}

