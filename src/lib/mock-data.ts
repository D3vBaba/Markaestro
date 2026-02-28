import {
    LayoutDashboard,
    Users,
    Mail,
    Workflow,
    BarChart3,
    Timer,
    Settings,
    LogOut
} from "lucide-react";

export const currentUser = {
    name: "Alex Marketing",
    email: "alex@markaestro.com",
    avatar: "https://github.com/shadcn.png",
    plan: "Pro"
};

export const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Contacts", href: "/contacts", icon: Users },
    { name: "Campaigns", href: "/campaigns", icon: Mail },
    { name: "Automations", href: "/automations", icon: Workflow },
    { name: "Analytics", href: "/analytics", icon: BarChart3 },
    { name: "Jobs", href: "/jobs", icon: Timer },
    { name: "Settings", href: "/settings", icon: Settings },
];
