"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Home,
  ChartNoAxesColumn,
  Package,
  LayoutGrid,
  Calendar,
  type LucideIcon,
} from "lucide-react";

const TABS: { id: string; href: string; icon: LucideIcon }[] = [
  { id: "home", href: "/dashboard", icon: Home },
  { id: "analytics", href: "/analytics", icon: ChartNoAxesColumn },
  { id: "brands", href: "/products", icon: Package },
  { id: "posts", href: "/content", icon: LayoutGrid },
  { id: "calendar", href: "/calendar", icon: Calendar },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const t = useTranslations("shell.mobileTabBar");

  return (
    <nav
      className="lg:hidden shrink-0 border-t"
      style={{
        background: "var(--mk-paper)",
        borderColor: "var(--mk-rule)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="grid grid-cols-5">
        {TABS.map((tab) => {
          const isActive =
            pathname === tab.href || pathname.startsWith(tab.href + "/");
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 min-h-[52px] select-none"
              style={{
                color: isActive ? "var(--mk-accent)" : "var(--mk-ink-60)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <Icon
                className="h-[21px] w-[21px]"
                strokeWidth={isActive ? 2.2 : 1.8}
              />
              <span
                className="text-[10px] leading-tight"
                style={{
                  fontWeight: isActive ? 600 : 400,
                  letterSpacing: "-0.005em",
                }}
              >
                {t(tab.id)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
