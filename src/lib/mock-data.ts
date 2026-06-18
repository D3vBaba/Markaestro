import {
    LayoutDashboard,
    LayoutGrid,
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
    { name: "Posts", href: "/content", icon: LayoutGrid },
    { name: "Settings", href: "/settings", icon: Settings },
];
