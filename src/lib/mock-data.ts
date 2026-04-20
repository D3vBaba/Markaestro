import {
    LayoutDashboard,
    Mail,
    BarChart3,
    Settings,
} from "lucide-react";

export const currentUser = {
    name: "Alex Marketing",
    email: "alex@markaestro.com",
    avatar: "https://github.com/shadcn.png",
    plan: "Pro"
};

export const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Campaigns", href: "/campaigns", icon: Mail },
    { name: "Analytics", href: "/analytics", icon: BarChart3 },
    { name: "Settings", href: "/settings", icon: Settings },
];
