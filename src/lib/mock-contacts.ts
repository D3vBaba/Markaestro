export type ContactStatus = "active" | "bounced" | "unsubscribed" | "pending";

export interface Contact {
    id: string;
    name: string;
    email: string;
    status: ContactStatus;
    tags: string[];
    lastActive: string;
    addedAt: string;
    avatar?: string;
}

export const mockContacts: Contact[] = [
    {
        id: "1",
        name: "Sarah Smith",
        email: "sarah.smith@example.com",
        status: "active",
        tags: ["customer", "newsletter"],
        lastActive: "2 hours ago",
        addedAt: "2023-10-15",
        avatar: "SS"
    },
    {
        id: "2",
        name: "Michael Chen",
        email: "m.chen@techcorp.io",
        status: "active",
        tags: ["lead", "enterprise"],
        lastActive: "1 day ago",
        addedAt: "2023-11-02",
        avatar: "MC"
    },
    {
        id: "3",
        name: "Jessica Williams",
        email: "jessica.w@gmail.com",
        status: "unsubscribed",
        tags: ["newsletter"],
        lastActive: "2 weeks ago",
        addedAt: "2023-09-10",
        avatar: "JW"
    },
    {
        id: "4",
        name: "David Brown",
        email: "david.brown@company.net",
        status: "bounced",
        tags: ["lead"],
        lastActive: "never",
        addedAt: "2023-12-01",
        avatar: "DB"
    },
    {
        id: "5",
        name: "Emily Davis",
        email: "emily.davis@design.studio",
        status: "active",
        tags: ["customer", "vip"],
        lastActive: "5 mins ago",
        addedAt: "2023-08-20",
        avatar: "ED"
    },
    {
        id: "6",
        name: "James Wilson",
        email: "jwilson@startup.co",
        status: "pending",
        tags: ["trial"],
        lastActive: "10 mins ago",
        addedAt: "2024-01-05",
        avatar: "JW"
    },
    {
        id: "7",
        name: "Olivia Martinez",
        email: "olivia.m@creative.agency",
        status: "active",
        tags: ["partner"],
        lastActive: "3 days ago",
        addedAt: "2023-07-12",
        avatar: "OM"
    },
    {
        id: "8",
        name: "William Taylor",
        email: "wtaylor@finance.org",
        status: "active",
        tags: ["enterprise", "customer"],
        lastActive: "1 week ago",
        addedAt: "2023-06-30",
        avatar: "WT"
    },
    {
        id: "9",
        name: "Sophia Anderson",
        email: "sophia.anderson@example.com",
        status: "unsubscribed",
        tags: ["lead"],
        lastActive: "1 month ago",
        addedAt: "2023-05-18",
        avatar: "SA"
    },
    {
        id: "10",
        name: "Alexander Thomas",
        email: "alex.thomas@dev.io",
        status: "active",
        tags: ["developer", "beta-tester"],
        lastActive: "1 hour ago",
        addedAt: "2023-11-20",
        avatar: "AT"
    },
    {
        id: "11",
        name: "Isabella Jackson",
        email: "ijackson@marketing.net",
        status: "active",
        tags: ["customer"],
        lastActive: "4 hours ago",
        addedAt: "2023-09-25",
        avatar: "IJ"
    },
    {
        id: "12",
        name: "Mason White",
        email: "mason.white@example.com",
        status: "bounced",
        tags: ["newsletter"],
        lastActive: "never",
        addedAt: "2023-12-15",
        avatar: "MW"
    }
];
