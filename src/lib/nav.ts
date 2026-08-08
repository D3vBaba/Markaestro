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
            { name: "Analytics", href: "/analytics" },
        ],
    },
    {
        group: "Marketing",
        items: [
            { name: "Brands", href: "/products" },
            { name: "Posts", href: "/content" },
            { name: "Calendar", href: "/calendar" },
        ],
    },
    {
        group: "Help",
        items: [
            { name: "Connect channels", href: "/guides/channels" },
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
