export type NavItem = {
    name: string;
    href: string;
};

export type NavGroup = {
    group: string;
    items: NavItem[];
};

export const navigationGroups: NavGroup[] = [
    {
        group: "Overview",
        items: [
            { name: "Dashboard", href: "/dashboard" },
        ],
    },
    {
        group: "Marketing",
        items: [
            { name: "Products", href: "/products" },
            { name: "Campaigns", href: "/campaigns" },
            { name: "Posts", href: "/content" },
            { name: "Slideshows", href: "/slideshows" },
            { name: "Calendar", href: "/calendar" },
        ],
    },
    {
        group: "Insights",
        items: [
            { name: "Analytics", href: "/analytics" },
        ],
    },
];

export const settingsItem: NavItem = {
    name: "Settings",
    href: "/settings",
};

// Flat list for backward compatibility (Header mobile menu, etc.)
export const navigation: NavItem[] = [
    ...navigationGroups.flatMap((g) => g.items),
    settingsItem,
];
