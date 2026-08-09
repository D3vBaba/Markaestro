export type NavItem = {
    id: string;
    href: string;
};

export type NavGroup = {
    id: string;
    items: NavItem[];
};

export const navigationGroups: NavGroup[] = [
    {
        id: "overview",
        items: [
            { id: "dashboard", href: "/dashboard" },
            { id: "analytics", href: "/analytics" },
        ],
    },
    {
        id: "marketing",
        items: [
            { id: "brands", href: "/products" },
            { id: "posts", href: "/content" },
            { id: "calendar", href: "/calendar" },
        ],
    },
    {
        id: "help",
        items: [
            { id: "connectChannels", href: "/guides/channels" },
        ],
    },
];

export const settingsItem: NavItem = {
    id: "settings",
    href: "/settings",
};

// Flat list for backward compatibility (Header mobile menu, etc.)
export const navigation: NavItem[] = [
    ...navigationGroups.flatMap((g) => g.items),
    settingsItem,
];
