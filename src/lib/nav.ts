import {
    LayoutDashboard,
    Users,
    Mail,
    Workflow,
    BarChart3,
    Timer,
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
            { name: "Automations", href: "/automations", icon: Workflow },
        ],
    },
    {
        group: "Insights",
        items: [
            { name: "Contacts", href: "/contacts", icon: Users },
            { name: "Analytics", href: "/analytics", icon: BarChart3 },
            { name: "Jobs", href: "/jobs", icon: Timer },
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
