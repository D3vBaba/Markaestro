"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader,
    SheetTitle, SheetTrigger, SheetFooter, SheetClose,
} from "@/components/ui/sheet";
import { Plus, Trash2, ExternalLink, Package } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import { apiGet, apiPost, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";

type Product = {
  id: string;
  name: string;
  description: string;
  url: string;
  category: string;
  status: string;
  pricingTier: string;
  tags: string[];
  createdAt?: string;
};

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  beta: "bg-blue-50 text-blue-700",
  development: "bg-amber-50 text-amber-700",
  sunset: "bg-rose-50 text-rose-700",
  archived: "bg-gray-100 text-gray-600",
};

const categoryLabels: Record<string, string> = {
  saas: "SaaS",
  mobile: "Mobile App",
  web: "Web App",
  api: "API",
  marketplace: "Marketplace",
  other: "Other",
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newCategory, setNewCategory] = useState("saas");
  const [newPricing, setNewPricing] = useState("");
  const [newTags, setNewTags] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchProducts = async () => {
    try {
      const res = await apiGet<{ products: Product[] }>("/api/products");
      if (res.ok) setProducts(res.data.products || []);
    } catch {
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const tags = newTags.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await apiPost("/api/products", {
        name: newName,
        description: newDescription,
        url: newUrl || "",
        category: newCategory,
        pricingTier: newPricing,
        tags,
      });
      if (res.ok) {
        toast.success("Product added");
        setNewName(""); setNewDescription(""); setNewUrl(""); setNewCategory("saas"); setNewPricing(""); setNewTags("");
        fetchProducts();
      } else {
        const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
        toast.error(errData.issues?.[0]?.message || errData.error || "Failed to create product");
      }
    } catch {
      toast.error("Failed to create product");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await apiDelete(`/api/products/${id}`);
    if (res.ok) {
      toast.success("Product deleted");
      fetchProducts();
    } else {
      toast.error("Failed to delete product");
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Products"
        subtitle="Register and track the applications you market."
        action={
          <Sheet>
            <SheetTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Add Product</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Register Product</SheetTitle>
                <SheetDescription>Add an application you want to market and track.</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Product Name</label>
                  <Input placeholder="DripCheckr" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea placeholder="AI-powered drip campaign analytics..." value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={3} />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">URL</label>
                  <Input placeholder="https://dripcheckr.com" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Category</label>
                  <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="saas">SaaS</option>
                    <option value="mobile">Mobile App</option>
                    <option value="web">Web App</option>
                    <option value="api">API</option>
                    <option value="marketplace">Marketplace</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Pricing Tier</label>
                  <Input placeholder="Free / Pro / Enterprise" value={newPricing} onChange={(e) => setNewPricing(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Tags (comma separated)</label>
                  <Input placeholder="analytics, ai, marketing" value={newTags} onChange={(e) => setNewTags(e.target.value)} />
                </div>
              </div>
              <SheetFooter>
                <SheetClose asChild>
                  <Button onClick={handleCreate} disabled={saving}>{saving ? "Saving..." : "Add Product"}</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <p className="text-sm text-muted-foreground col-span-full">Loading products...</p>
        ) : products.length === 0 ? (
          <Card className="col-span-full shadow-sm">
            <CardContent className="py-16 text-center">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium text-foreground">No products registered yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add your first application to start tracking its marketing performance.</p>
            </CardContent>
          </Card>
        ) : (
          products.map((p) => (
            <Card key={p.id} className="shadow-sm hover:shadow-md transition-shadow duration-200">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {categoryLabels[p.category] || p.category}
                      {p.pricingTier && ` • ${p.pricingTier}`}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <Badge variant="outline" className={`capitalize border-0 text-xs ${statusColors[p.status] || ""}`}>
                      {p.status}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {p.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{p.description}</p>
                )}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1 mb-3">
                    <ExternalLink className="h-3 w-3" /> {p.url}
                  </a>
                )}
                {p.tags && p.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.tags.map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[10px] font-medium border border-border">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {p.createdAt && (
                  <p className="text-xs text-muted-foreground mt-3">Added {new Date(p.createdAt).toLocaleDateString()}</p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
