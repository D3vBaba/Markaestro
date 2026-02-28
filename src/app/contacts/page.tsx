"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader,
    SheetTitle, SheetTrigger, SheetFooter, SheetClose,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreHorizontal, Plus, Search, Filter, Download, Trash2 } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import MetricCard from "@/components/app/MetricCard";
import { apiGet, apiPost, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";

type Contact = {
    id: string;
    name: string;
    email: string;
    status: string;
    lifecycleStage?: string;
    source?: string;
    tags: string[];
    createdAt?: string;
};

const statusColors: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700",
    bounced: "bg-rose-50 text-rose-700",
    unsubscribed: "bg-gray-100 text-gray-600",
    pending: "bg-amber-50 text-amber-700",
};

export default function ContactsPage() {
    const [contacts, setContacts] = React.useState<Contact[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [searchTerm, setSearchTerm] = React.useState("");
    const [statusFilter, setStatusFilter] = React.useState("all");
    const [selectedContacts, setSelectedContacts] = React.useState<Set<string>>(new Set());

    // Add contact form state
    const [newName, setNewName] = React.useState("");
    const [newEmail, setNewEmail] = React.useState("");
    const [newTags, setNewTags] = React.useState("");
    const [newStatus, setNewStatus] = React.useState("active");
    const [newLifecycle, setNewLifecycle] = React.useState("lead");
    const [newSource, setNewSource] = React.useState("direct");
    const [saving, setSaving] = React.useState(false);

    const fetchContacts = React.useCallback(async () => {
        try {
            const res = await apiGet<{ contacts: Contact[] }>("/api/contacts");
            if (res.ok) setContacts(res.data.contacts || []);
        } catch {
            toast.error("Failed to load contacts");
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchContacts();
    }, [fetchContacts]);

    const filteredContacts = contacts.filter((contact) => {
        const matchesSearch =
            contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            contact.email.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === "all" || contact.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    const toggleSelectAll = () => {
        if (selectedContacts.size === filteredContacts.length) {
            setSelectedContacts(new Set());
        } else {
            setSelectedContacts(new Set(filteredContacts.map((c) => c.id)));
        }
    };

    const toggleSelect = (id: string) => {
        const next = new Set(selectedContacts);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelectedContacts(next);
    };

    const handleAddContact = async () => {
        setSaving(true);
        try {
            const tags = newTags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
            const res = await apiPost("/api/contacts", {
                name: newName,
                email: newEmail,
                status: newStatus,
                lifecycleStage: newLifecycle,
                source: newSource,
                tags,
            });
            if (res.ok) {
                toast.success("Contact added");
                setNewName("");
                setNewEmail("");
                setNewTags("");
                setNewStatus("active");
                fetchContacts();
            } else {
                const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
                toast.error(errData.issues?.[0]?.message || errData.error || "Failed to add contact");
            }
        } catch {
            toast.error("Failed to add contact");
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteSelected = async () => {
        for (const id of selectedContacts) {
            await apiDelete(`/api/contacts/${id}`);
        }
        toast.success(`Deleted ${selectedContacts.size} contact(s)`);
        setSelectedContacts(new Set());
        fetchContacts();
    };

    const handleDeleteContact = async (id: string) => {
        await apiDelete(`/api/contacts/${id}`);
        toast.success("Contact deleted");
        fetchContacts();
    };

    // Stats from real data
    const totalCount = contacts.length;
    const activeCount = contacts.filter((c) => c.status === "active").length;
    const pendingCount = contacts.filter((c) => c.status === "pending").length;
    const bouncedCount = contacts.filter((c) => ["bounced", "unsubscribed"].includes(c.status)).length;

    return (
        <AppShell>
            <div className="flex flex-col space-y-4 h-full">
                <PageHeader
                    title="Contacts"
                    subtitle="Manage your audience and leads."
                    action={
                        <>
                            <Button variant="outline" className="bg-background">
                                <Download className="mr-2 h-4 w-4" /> Export
                            </Button>
                            <Sheet>
                                <SheetTrigger asChild>
                                    <Button>
                                        <Plus className="mr-2 h-4 w-4" /> Add Contact
                                    </Button>
                                </SheetTrigger>
                                <SheetContent>
                                    <SheetHeader>
                                        <SheetTitle>Add New Contact</SheetTitle>
                                        <SheetDescription>Add a single contact to your database.</SheetDescription>
                                    </SheetHeader>
                                    <div className="grid gap-4 py-4">
                                        <div className="grid gap-2">
                                            <label htmlFor="name" className="text-sm font-medium">Name</label>
                                            <Input id="name" placeholder="John Doe" value={newName} onChange={(e) => setNewName(e.target.value)} />
                                        </div>
                                        <div className="grid gap-2">
                                            <label htmlFor="email" className="text-sm font-medium">Email</label>
                                            <Input id="email" placeholder="john@example.com" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                                        </div>
                                        <div className="grid gap-2">
                                            <label htmlFor="tags" className="text-sm font-medium">Tags (comma separated)</label>
                                            <Input id="tags" placeholder="lead, newsletter" value={newTags} onChange={(e) => setNewTags(e.target.value)} />
                                        </div>
                                        <div className="grid gap-2">
                                            <label htmlFor="status" className="text-sm font-medium">Status</label>
                                            <select
                                                value={newStatus}
                                                onChange={(e) => setNewStatus(e.target.value)}
                                                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                            >
                                                <option value="active">Active</option>
                                                <option value="pending">Pending</option>
                                            </select>
                                        </div>
                                        <div className="grid gap-2">
                                            <label className="text-sm font-medium">Lifecycle Stage</label>
                                            <select
                                                value={newLifecycle}
                                                onChange={(e) => setNewLifecycle(e.target.value)}
                                                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                            >
                                                <option value="lead">Lead</option>
                                                <option value="trial">Trial</option>
                                                <option value="customer">Customer</option>
                                                <option value="churned">Churned</option>
                                                <option value="advocate">Advocate</option>
                                            </select>
                                        </div>
                                        <div className="grid gap-2">
                                            <label className="text-sm font-medium">Source</label>
                                            <select
                                                value={newSource}
                                                onChange={(e) => setNewSource(e.target.value)}
                                                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                            >
                                                <option value="organic">Organic</option>
                                                <option value="paid">Paid</option>
                                                <option value="referral">Referral</option>
                                                <option value="social">Social</option>
                                                <option value="email">Email</option>
                                                <option value="direct">Direct</option>
                                                <option value="other">Other</option>
                                            </select>
                                        </div>
                                    </div>
                                    <SheetFooter>
                                        <SheetClose asChild>
                                            <Button onClick={handleAddContact} disabled={saving}>
                                                {saving ? "Saving..." : "Save Contact"}
                                            </Button>
                                        </SheetClose>
                                    </SheetFooter>
                                </SheetContent>
                            </Sheet>
                        </>
                    }
                />

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <MetricCard label="Total Contacts" value={String(totalCount)} />
                    <MetricCard label="Active" value={String(activeCount)} />
                    <MetricCard label="Pending" value={String(pendingCount)} />
                    <MetricCard label="Bounced + Unsub" value={String(bouncedCount)} />
                </div>

                <div className="flex items-center gap-2 py-4">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Filter contacts..."
                            className="pl-8"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2 border rounded-md px-3 h-9 w-[200px]">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-transparent text-sm outline-none w-full"
                        >
                            <option value="all">All Statuses</option>
                            <option value="active">Active</option>
                            <option value="pending">Pending</option>
                            <option value="bounced">Bounced</option>
                            <option value="unsubscribed">Unsubscribed</option>
                        </select>
                    </div>

                    {selectedContacts.size > 0 && (
                        <Button variant="destructive" size="sm" className="ml-auto" onClick={handleDeleteSelected}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete ({selectedContacts.size})
                        </Button>
                    )}
                </div>

                <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">
                                    <Checkbox
                                        checked={selectedContacts.size === filteredContacts.length && filteredContacts.length > 0}
                                        onCheckedChange={toggleSelectAll}
                                    />
                                </TableHead>
                                <TableHead>Contact</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Lifecycle</TableHead>
                                <TableHead>Tags</TableHead>
                                <TableHead>Added</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                                        Loading contacts...
                                    </TableCell>
                                </TableRow>
                            ) : filteredContacts.length > 0 ? (
                                filteredContacts.map((contact) => {
                                    const initials = contact.name
                                        .split(" ")
                                        .map((n) => n[0])
                                        .join("")
                                        .toUpperCase()
                                        .slice(0, 2);
                                    return (
                                        <TableRow key={contact.id} data-state={selectedContacts.has(contact.id) && "selected"}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={selectedContacts.has(contact.id)}
                                                    onCheckedChange={() => toggleSelect(contact.id)}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-9 w-9 border border-border bg-muted">
                                                        <AvatarFallback className="text-xs font-medium text-foreground">{initials}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium text-sm text-foreground">{contact.name}</span>
                                                        <span className="text-xs text-muted-foreground">{contact.email}</span>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={`capitalize font-normal border-0 ${statusColors[contact.status] || ""}`}>
                                                    {contact.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="capitalize font-normal text-xs">
                                                    {contact.lifecycleStage || "lead"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1">
                                                    {(contact.tags || []).map((tag) => (
                                                        <span key={tag} className="px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[10px] font-medium border border-border">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {contact.createdAt ? new Date(contact.createdAt).toLocaleDateString() : "—"}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" className="h-8 w-8 p-0">
                                                            <span className="sr-only">Open menu</span>
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                        <DropdownMenuItem>View details</DropdownMenuItem>
                                                        <DropdownMenuItem>Edit contact</DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            className="text-destructive focus:text-destructive"
                                                            onClick={() => handleDeleteContact(contact.id)}
                                                        >
                                                            Delete contact
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                                        No contacts matched this filter.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex items-center justify-end space-x-2 py-4">
                    <div className="flex-1 text-sm text-muted-foreground">
                        {selectedContacts.size} of {filteredContacts.length} row(s) selected.
                    </div>
                </div>
            </div>
        </AppShell>
    );
}
