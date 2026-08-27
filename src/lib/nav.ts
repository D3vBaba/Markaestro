import { canAccessIntelligencePreview } from '@/lib/intelligence/preview-access';

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
            { id: "intelligence", href: "/intelligence" },
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

export function navigationGroupsForUser(email?: string | null, uid?: string | null): NavGroup[] {
    if (canAccessIntelligencePreview({ email, uid })) return navigationGroups;
    return navigationGroups.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.href !== "/intelligence"),
    }));
}

// Flat list for backward compatibility (Header mobile menu, etc.)
export const navigation: NavItem[] = [
    ...navigationGroups.flatMap((g) => g.items),
    settingsItem,
];

export function navigationForUser(email?: string | null, uid?: string | null): NavItem[] {
    return [...navigationGroupsForUser(email, uid).flatMap((g) => g.items), settingsItem];
}
