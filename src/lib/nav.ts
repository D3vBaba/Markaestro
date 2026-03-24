import {
    LayoutDashboard,
    Mail,
    BarChart3,
    Settings,
    Package,
    Send,
    Megaphone,
    CalendarDays,
    type LucideIcon,
} from "lucide-react";

export type NavItem = {
    name: string;
    href: string;
    icon: LucideIcon;
};

export type NavGroup = {
    group: string;
    items: NavItem[];
};

export const navigationGroups: NavGroup[] = [
    {
        group: "Overview",
        items: [
            { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        ],
    },
    {
        group: "Marketing",
        items: [
            { name: "Products", href: "/products", icon: Package },
            { name: "Campaigns", href: "/campaigns", icon: Mail },
            { name: "Posts", href: "/content", icon: Send },
            { name: "Ads", href: "/ads", icon: Megaphone },
            { name: "Calendar", href: "/calendar", icon: CalendarDays },
        ],
    },
    {
        group: "Insights",
        items: [
            { name: "Analytics", href: "/analytics", icon: BarChart3 },
        ],
    },
];

export const settingsItem: NavItem = {
    name: "Settings",
    href: "/settings",
    icon: Settings,
};

// Flat list for backward compatibility (Header mobile menu, etc.)
export const navigation: NavItem[] = [
    ...navigationGroups.flatMap((g) => g.items),
    settingsItem,
];
