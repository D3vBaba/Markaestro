"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost, apiFetch, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";
import { ChevronLeft, Trash2 } from "lucide-react";
import SlideshowStatusBadge from "../_components/SlideshowStatusBadge";
import SlideListEditor from "../_components/SlideListEditor";

type Slide = {
  id: string;
  index: number;
  kind: "hook" | "body" | "cta";
  headline: string;
  body: string;
  imageUrl: string;
  imageStatus: "pending" | "generated" | "failed";
  quality?: {
    hookStrength: number;
    readability: number;
    distinctiveness: number;
    visualClarity: number;
    notes: string[];
  };
};

type Slideshow = {
  id: string;
  title: string;
  caption: string;
  status: string;
  channel: string;
  slideCount: number;
  productId: string;
  coverSlideIndex: number;
  exportPostId?: string;
  slides: Slide[];
};

const RUNNING_STATUSES = new Set(["researching", "generating_slides", "generating_images"]);

export default function SlideshowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [slideshow, setSlideshow] = useState<Slideshow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [caption, setCaption] = useState("");
  const [savingCaption, setSavingCaption] = useState(false);

  const load = useCallback(async () => {
    const res = await apiGet<Slideshow>(`/api/slideshows/${id}`);
    if (!res.ok) { toast.error("Failed to load slideshow"); return; }
    setSlideshow(res.data);
    setCaption(res.data.caption ?? "");
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Poll while generation is running
  useEffect(() => {
    if (!slideshow || !RUNNING_STATUSES.has(slideshow.status)) return;
    const timer = setInterval(async () => {
      const res = await apiGet<Slideshow>(`/api/slideshows/${id}`);
      if (!res.ok) return;
      setSlideshow(res.data);
      setCaption(res.data.caption ?? "");
      if (!RUNNING_STATUSES.has(res.data.status)) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [id, slideshow?.status]);

  const handleGenerate = async () => {
    setGenerating(true);
    // Optimistically mark as running so the polling loop starts immediately
    setSlideshow((prev) => (prev ? { ...prev, status: "researching" } : prev));
    try {
      const res = await apiPost(`/api/slideshows/${id}/generate`, {});
      if (!res.ok) {
        const err = res.data as unknown as { error?: string };
        toast.error(err.error ?? "Generation failed");
        // Reload to get the actual status (may be 'failed')
        await load();
        return;
      }
      toast.success("Slideshow generated successfully");
      await load();
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this slideshow? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await apiDelete(`/api/slideshows/${id}`);
      if (!res.ok) {
        toast.error("Failed to delete slideshow");
        return;
      }
      toast.success("Slideshow deleted");
      router.push("/slideshows");
    } catch {
      toast.error("Failed to delete slideshow");
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiPost<{ postId: string }>(`/api/slideshows/${id}/export`, {});
      if (!res.ok) {
        const err = res.data as unknown as { error?: string };
        toast.error(err.error ?? "Export failed");
        return;
      }
      toast.success("Exported to Posts");
      load();
    } finally {
      setExporting(false);
    }
  };

  const handleSaveCaption = async () => {
    if (!slideshow) return;
    setSavingCaption(true);
    try {
      await apiFetch(`/api/slideshows/${id}?workspaceId=default`, {
        method: "PATCH",
        body: JSON.stringify({ caption }),
      });
      toast.success("Caption saved");
    } catch {
      toast.error("Failed to save caption");
    } finally {
      setSavingCaption(false);
    }
  };

  const handleSlideUpdated = useCallback((updated: Partial<Slide> & { id: string }) => {
    setSlideshow((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        slides: prev.slides.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
      };
    });
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-32">
          <div className="h-8 w-8 rounded-full border-2 border-muted border-t-foreground animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!slideshow) {
    return (
      <AppShell>
        <div className="text-center py-32">
          <p className="text-muted-foreground">Slideshow not found.</p>
          <Link href="/slideshows" className="text-sm text-primary mt-4 inline-block">Back to slideshows</Link>
        </div>
      </AppShell>
    );
  }

  const isRunning = RUNNING_STATUSES.has(slideshow.status);
  const canGenerate = !isRunning && slideshow.status !== "exported";
  const canExport = slideshow.status === "ready";

  return (
    <AppShell>
      {/* Back link */}
      <Link
        href="/slideshows"
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Slideshows
      </Link>

      <PageHeader
        title={slideshow.title || "Untitled Slideshow"}
        subtitle={`${slideshow.slideCount} slides · TikTok · 9:16`}
        action={
          <div className="flex items-center gap-2">
            <SlideshowStatusBadge status={slideshow.status} />
            {canGenerate && !generating && (
              <Button
                size="sm"
                variant={slideshow.slides.length > 0 ? "outline" : "default"}
                onClick={handleGenerate}
              >
                {slideshow.slides.length > 0 ? "Regenerate" : "Generate"}
              </Button>
            )}
            {(isRunning || generating) && (
              <Button size="sm" variant="outline" disabled>
                <span className="w-3.5 h-3.5 mr-1.5 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
                Generating…
              </Button>
            )}
            {canExport && (
              <Button size="sm" onClick={handleExport} disabled={exporting}>
                {exporting ? "Exporting…" : "Export to Posts"}
              </Button>
            )}
            {slideshow.status === "exported" && slideshow.exportPostId && (
              <Link href="/content">
                <Button size="sm" variant="outline">View Post</Button>
              </Link>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDelete}
              disabled={deleting || isRunning || generating}
              className="text-muted-foreground hover:text-red-600 hover:bg-red-50"
              title="Delete slideshow"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        }
      />

      {/* Caption */}
      <div className="mb-8 space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Caption</p>
        <div className="flex gap-2 items-start">
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            placeholder="TikTok caption for this slideshow…"
            className="resize-none text-sm flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleSaveCaption}
            disabled={savingCaption || caption === (slideshow.caption ?? "")}
          >
            {savingCaption ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Slides */}
      <div className="space-y-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Slides ({slideshow.slides.length})
        </p>
        <SlideListEditor
          slides={slideshow.slides}
          slideshowId={id}
          onSlideUpdated={handleSlideUpdated}
        />
      </div>
    </AppShell>
  );
}
