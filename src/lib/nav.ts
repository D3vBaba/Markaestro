import {
    LayoutDashboard,
    Users,
    Mail,
    Workflow,
    BarChart3,
    Timer,
    Settings,
    Package,
    Sparkles,
} from "lucide-react";

export const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Products", href: "/products", icon: Package },
    { name: "Contacts", href: "/contacts", icon: Users },
    { name: "Campaigns", href: "/campaigns", icon: Mail },
    { name: "Content Studio", href: "/content", icon: Sparkles },
    { name: "Automations", href: "/automations", icon: Workflow },
    { name: "Analytics", href: "/analytics", icon: BarChart3 },
    { name: "Jobs", href: "/jobs", icon: Timer },
    { name: "Settings", href: "/settings", icon: Settings },
];
