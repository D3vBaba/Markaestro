"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
    Search,
    Home,
    Package,
    LayoutGrid,
    Calendar,
    Settings,
    Link2,
    SquarePen,
    PackagePlus,
    CreditCard,
    type LucideIcon,
    BookOpen,
} from "lucide-react";
import { navigationGroups, settingsItem } from "@/lib/nav";

const NAV_ICONS: Record<string, LucideIcon> = {
    "/dashboard": Home,
    "/products": Package,
    "/content": LayoutGrid,
    "/calendar": Calendar,
    "/channels": Link2,
    "/settings": Settings,
    "/guides/channels": BookOpen,
};

type PaletteItemData = {
    id: string;
    href: string;
    icon: LucideIcon;
    keywords?: string[];
};

const NAVIGATION_ITEMS: PaletteItemData[] = [
    ...navigationGroups.flatMap((group) =>
        group.items.map((item) => ({
            id: item.id,
            href: item.href,
            icon: NAV_ICONS[item.href] ?? Home,
            keywords: item.id === "brands" ? ["products", "brand"] : undefined,
        })),
    ),
    { id: "channels", href: "/channels", icon: Link2, keywords: ["integrations", "connections"] },
    { id: settingsItem.id, href: settingsItem.href, icon: Settings },
];

const QUICK_ACTIONS: PaletteItemData[] = [
    { id: "createPost", href: "/content", icon: SquarePen, keywords: ["new", "write", "content"] },
    { id: "addBrand", href: "/products", icon: PackagePlus, keywords: ["new", "create", "product"] },
    { id: "connectChannel", href: "/channels", icon: Link2, keywords: ["integration", "social"] },
    { id: "billing", href: "/settings?tab=billing", icon: CreditCard, keywords: ["plan", "subscription", "upgrade", "invoice"] },
];

export function CommandPalette({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const router = useRouter();
    const t = useTranslations("shell.commandPalette");
    const tNav = useTranslations("shell.nav");

    // "Channels" and quick actions aren't sidebar nav items, so they don't
    // have a shell.nav.items entry — resolve those from this namespace
    // instead while everything else reuses the sidebar's own labels.
    const paletteLabel = (id: string): string =>
        id === "channels" ? t("channels") : tNav(`items.${id}`);

    const navigationItems = useMemo(
        () => NAVIGATION_ITEMS.map((item) => ({ ...item, label: paletteLabel(item.id) })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, tNav],
    );
    const quickActions = useMemo(
        () => QUICK_ACTIONS.map((item) => ({ ...item, label: t(`actions.${item.id}`) })),
        [t],
    );

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                onOpenChange(!open);
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onOpenChange]);

    function go(href: string) {
        onOpenChange(false);
        router.push(href);
    }

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50" />
                <DialogPrimitive.Content
                    className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[10%] sm:top-[20%] left-[50%] z-50 w-[calc(100%-2rem)] max-w-[560px] translate-x-[-50%] rounded-xl border shadow-xl overflow-hidden p-0 duration-200"
                    style={{ background: "var(--mk-paper)", borderColor: "var(--mk-rule)" }}
                >
                    <DialogPrimitive.Title className="sr-only">{t("title")}</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="sr-only">
                        {t("description")}
                    </DialogPrimitive.Description>
                    <Command label={t("title")}>
                        <div
                            className="flex items-center gap-2.5 px-4 border-b"
                            style={{ borderColor: "var(--mk-rule)" }}
                        >
                            <Search className="h-4 w-4 shrink-0" style={{ color: "var(--mk-ink-40)" }} />
                            <Command.Input
                                autoFocus
                                placeholder={t("searchPlaceholder")}
                                className="flex-1 h-12 bg-transparent border-none outline-none text-[13.5px]"
                                style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                            />
                            <span
                                className="font-mono text-[9.5px] px-1.5 py-px rounded shrink-0"
                                style={{
                                    color: "var(--mk-ink-40)",
                                    border: "1px solid var(--mk-rule)",
                                    letterSpacing: "0.04em",
                                }}
                            >
                                ESC
                            </span>
                        </div>
                        <Command.List className="max-h-[min(320px,55dvh)] overflow-y-auto p-2">
                            <Command.Empty
                                className="py-8 text-center text-[12.5px]"
                                style={{ color: "var(--mk-ink-40)" }}
                            >
                                {t("noResults")}
                            </Command.Empty>
                            <Command.Group
                                heading={t("groupNavigation")}
                                className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.2em] [&_[cmdk-group-heading]]:text-[var(--mk-ink-40)]"
                            >
                                {navigationItems.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                        <Command.Item
                                            key={`nav-${item.href}`}
                                            value={`${item.label} ${item.keywords?.join(" ") ?? ""}`}
                                            onSelect={() => go(item.href)}
                                            className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] cursor-pointer data-[selected=true]:bg-[var(--mk-panel)]"
                                            style={{ color: "var(--mk-ink-80)", letterSpacing: "-0.005em" }}
                                        >
                                            <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--mk-ink-60)" }} />
                                            <span>{item.label}</span>
                                        </Command.Item>
                                    );
                                })}
                            </Command.Group>
                            <Command.Group
                                heading={t("groupQuickActions")}
                                className="mt-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.2em] [&_[cmdk-group-heading]]:text-[var(--mk-ink-40)]"
                            >
                                {quickActions.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                        <Command.Item
                                            key={`action-${item.id}`}
                                            value={`${item.label} ${item.keywords?.join(" ") ?? ""}`}
                                            onSelect={() => go(item.href)}
                                            className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] cursor-pointer data-[selected=true]:bg-[var(--mk-panel)]"
                                            style={{ color: "var(--mk-ink-80)", letterSpacing: "-0.005em" }}
                                        >
                                            <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--mk-ink-60)" }} />
                                            <span>{item.label}</span>
                                        </Command.Item>
                                    );
                                })}
                            </Command.Group>
                        </Command.List>
                    </Command>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
