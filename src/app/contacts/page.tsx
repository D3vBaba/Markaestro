"use client";

import * as React from "react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetFooter,
    SheetClose
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
    MoreHorizontal,
    Plus,
    Search,
    Filter,
    Download,
    Trash2,
    UserPlus
} from "lucide-react";
import { mockContacts, Contact, ContactStatus } from "@/lib/mock-contacts";
import PageHeader from "@/components/app/PageHeader";
import MetricCard from "@/components/app/MetricCard";

export default function ContactsPage() {
    const [searchTerm, setSearchTerm] = React.useState("");
    const [statusFilter, setStatusFilter] = React.useState<string>("all");
    const [selectedContacts, setSelectedContacts] = React.useState<Set<string>>(new Set());

    // Filter logic
    const filteredContacts = mockContacts.filter(contact => {
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
            setSelectedContacts(new Set(filteredContacts.map(c => c.id)));
        }
    };

    const toggleSelect = (id: string) => {
        const newSelected = new Set(selectedContacts);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedContacts(newSelected);
    };

    return (
        <AppShell>
            <div className="flex flex-col space-y-4 h-full">
                {/* Header */}
                <PageHeader
                    title="Contacts"
                    subtitle="Manage your audience and leads."
                    action={<><Button variant="outline" className="bg-background"><Download className="mr-2 h-4 w-4" /> Export</Button><Sheet>
                            <SheetTrigger asChild>
                                <Button>
                                    <Plus className="mr-2 h-4 w-4" /> Add Contact
                                </Button>
                            </SheetTrigger>

                            <SheetTrigger asChild>
                                <Button>
                                    <Plus className="mr-2 h-4 w-4" /> Add Contact
                                </Button>
                            </SheetTrigger>
                            <SheetContent>
                                <SheetHeader>
                                    <SheetTitle>Add New Contact</SheetTitle>
                                    <SheetDescription>
                                        Add a single contact to your database.
                                    </SheetDescription>
                                </SheetHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                        <label htmlFor="name" className="text-sm font-medium">Name</label>
                                        <Input id="name" placeholder="John Doe" />
                                    </div>
                                    <div className="grid gap-2">
                                        <label htmlFor="email" className="text-sm font-medium">Email</label>
                                        <Input id="email" placeholder="john@example.com" type="email" />
                                    </div>
                                    <div className="grid gap-2">
                                        <label htmlFor="tags" className="text-sm font-medium">Tags (comma separated)</label>
                                        <Input id="tags" placeholder="lead, newsletter" />
                                    </div>
                                    <div className="grid gap-2">
                                        <label htmlFor="status" className="text-sm font-medium">Status</label>
                                        <select defaultValue="active" className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                                            <option value="active">Active</option>
                                            <option value="pending">Pending</option>
                                        </select>
                                    </div>
                                </div>
                                <SheetFooter>
                                    <SheetClose asChild>
                                        <Button type="submit">Save Contact</Button>
                                    </SheetClose>
                                </SheetFooter>
                            </SheetContent>
                        </Sheet></>}
                />


                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <MetricCard label="Total Contacts" value={String(mockContacts.length)} delta={12} />
                    <MetricCard label="Active" value={String(mockContacts.filter(c=>c.status==="active").length)} delta={8} />
                    <MetricCard label="Pending" value={String(mockContacts.filter(c=>c.status==="pending").length)} delta={-2} />
                    <MetricCard label="Bounced + Unsub" value={String(mockContacts.filter(c=>["bounced","unsubscribed"].includes(c.status)).length)} delta={-5} />
                </div>
                {/* Filters */}
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
                        <Button variant="destructive" size="sm" className="ml-auto">
                            <Trash2 className="mr-2 h-4 w-4" /> Delete ({selectedContacts.size})
                        </Button>
                    )}
                </div>

                {/* Table */}
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
                                <TableHead>Tags</TableHead>
                                <TableHead>Last Active</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredContacts.length > 0 ? (
                                filteredContacts.map((contact) => (
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
                                                    <AvatarFallback className="text-xs font-medium text-foreground">{contact.avatar}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-sm text-foreground">{contact.name}</span>
                                                    <span className="text-xs text-muted-foreground">{contact.email}</span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={`
                         capitalize font-normal border-0
                         ${contact.status === 'active' ? 'bg-emerald-50 text-emerald-700' : ''}
                         ${contact.status === 'bounced' ? 'bg-rose-50 text-rose-700' : ''}
                         ${contact.status === 'unsubscribed' ? 'bg-gray-100 text-gray-600' : ''}
                         ${contact.status === 'pending' ? 'bg-amber-50 text-amber-700' : ''}
                       `}>
                                                {contact.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {contact.tags.map(tag => (
                                                    <span key={tag} className="px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[10px] font-medium border border-border">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">
                                            {contact.lastActive}
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
                                                    <DropdownMenuItem className="text-destructive focus:text-destructive">
                                                        Delete contact
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                                        No contacts matched this filter.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Simple Pagination */}
                <div className="flex items-center justify-end space-x-2 py-4">
                    <div className="flex-1 text-sm text-muted-foreground">
                        {selectedContacts.size} of {filteredContacts.length} row(s) selected.
                    </div>
                    <Button variant="outline" size="sm" disabled>
                        Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                        Next
                    </Button>
                </div>
            </div>
        </AppShell>
    );
}
