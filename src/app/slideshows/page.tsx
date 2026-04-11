"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import Select from "@/components/app/Select";
import { apiGet } from "@/lib/api-client";
import SlideshowStatusBadge from "./_components/SlideshowStatusBadge";
import SlideshowCreateSheet from "./_components/SlideshowCreateSheet";

type Slideshow = {
  id: string;
  title: string;
  status: string;
  channel: string;
  slideCount: number;
  caption: string;
  productId: string;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "markaestro_default_product";

const statusFilterOptions = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "exported", label: "Exported" },
  { value: "failed", label: "Failed" },
];

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function SlideshowCard({ slideshow }: { slideshow: Slideshow }) {
  return (
    <Link href={`/slideshows/${slideshow.id}`} className="block group">
      <div className="border border-border/50 rounded-xl overflow-hidden bg-card hover:border-border/80 hover:shadow-sm transition-all">
        {/* Thumbnail placeholder */}
        <div className="aspect-[9/16] max-h-40 bg-muted/40 flex items-center justify-center overflow-hidden">
          <span className="text-[10px] text-muted-foreground/40 uppercase tracking-widest">9:16</span>
        </div>

        <div className="px-4 py-3 space-y-2">
          <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-foreground transition-colors">
            {slideshow.title || "Untitled Slideshow"}
          </p>

          <div className="flex items-center justify-between gap-2">
            <SlideshowStatusBadge status={slideshow.status} />
            <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
              {slideshow.slideCount ?? "—"} slides
            </span>
          </div>

          <p className="text-[10px] text-muted-foreground/50">{formatDate(slideshow.createdAt)}</p>
        </div>
      </div>
    </Link>
  );
}

export default function SlideshowsPage() {
  const [slideshows, setSlideshows] = useState<Slideshow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const defaultProductId =
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) ?? "" : "";

  const load = useCallback(async () => {
    setLoading(true);
    const path = statusFilter ? `/api/slideshows?status=${statusFilter}` : "/api/slideshows";
    const res = await apiGet<{ slideshows: Slideshow[] }>(path);
    if (res.ok) setSlideshows(res.data.slideshows ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <AppShell>
      <PageHeader
        title="Slideshows"
        subtitle="Create TikTok carousel slideshows from your products."
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            New Slideshow
          </Button>
        }
      />

      <div className="flex items-center gap-3 mb-6">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-44"
        >
          {statusFilterOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <span className="text-[11px] text-muted-foreground">
          {loading ? "Loading…" : `${slideshows.length} slideshow${slideshows.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {!loading && slideshows.length === 0 && (
        <div className="border-2 border-dashed border-border/40 rounded-2xl py-20 text-center">
          <p className="text-sm text-muted-foreground">No slideshows yet.</p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => setCreateOpen(true)}>
            Create your first slideshow
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {slideshows.map((ss) => (
          <SlideshowCard key={ss.id} slideshow={ss} />
        ))}
      </div>

      <SlideshowCreateSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultProductId={defaultProductId}
      />
    </AppShell>
  );
}
