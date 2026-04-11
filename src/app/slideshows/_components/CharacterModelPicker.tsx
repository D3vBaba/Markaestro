"use client";

import { useState, useEffect } from "react";
import { apiGet } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import type { CharacterModelGender, CharacterModelStyle } from "@/lib/schemas";

type CharacterModelSummary = {
  id: string;
  name: string;
  description: string;
  gender: CharacterModelGender;
  ageRange: string;
  ethnicity: string;
  style: CharacterModelStyle;
  thumbnailUrl: string;
};

const GENDER_LABELS: Record<string, string> = {
  all: "All",
  female: "Women",
  male: "Men",
  nonbinary: "Nonbinary",
};

const STYLE_LABELS: Record<string, string> = {
  all: "All styles",
  casual: "Casual",
  professional: "Professional",
  fitness: "Fitness",
  lifestyle: "Lifestyle",
  streetwear: "Streetwear",
};

export default function CharacterModelPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (modelId: string | null) => void;
}) {
  const [models, setModels] = useState<CharacterModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [genderFilter, setGenderFilter] = useState<string>("all");
  const [styleFilter, setStyleFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setFetchError(false);
      const res = await apiGet<{ models: CharacterModelSummary[] }>("/api/character-models");
      if (res.ok) {
        setModels(res.data.models ?? []);
      } else {
        setFetchError(true);
      }
      setLoading(false);
    })();
  }, []);

  const filtered = models.filter((m) => {
    if (genderFilter !== "all" && m.gender !== genderFilter) return false;
    if (styleFilter !== "all" && m.style !== styleFilter) return false;
    return true;
  });

  const genders = ["all", ...Array.from(new Set(models.map((m) => m.gender)))];
  const styles = ["all", ...Array.from(new Set(models.map((m) => m.style)))];

  return (
    <div className="space-y-3">
      {/* No character option */}
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
          value === null
            ? "border-primary bg-primary/5 text-primary"
            : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
        }`}
      >
        <span className="flex-shrink-0 w-9 h-9 rounded-md bg-muted flex items-center justify-center text-base">
          📷
        </span>
        <div className="text-left">
          <div className="font-medium text-xs">No character model</div>
          <div className="text-[10px] text-muted-foreground/70">Product & lifestyle images only</div>
        </div>
        {value === null && (
          <span className="ml-auto text-primary text-xs font-medium">Selected</span>
        )}
      </button>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {genders.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGenderFilter(g)}
            className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
              genderFilter === g
                ? "bg-foreground text-background border-foreground"
                : "border-border/50 text-muted-foreground hover:border-border"
            }`}
          >
            {GENDER_LABELS[g] ?? g}
          </button>
        ))}
        <div className="w-px bg-border/30 flex-shrink-0 mx-1" />
        {styles.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStyleFilter(s)}
            className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
              styleFilter === s
                ? "bg-foreground text-background border-foreground"
                : "border-border/50 text-muted-foreground hover:border-border"
            }`}
          >
            {STYLE_LABELS[s] ?? s}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-lg" />
          ))}
        </div>
      ) : fetchError ? (
        <p className="text-xs text-destructive text-center py-4">
          Failed to load models. Please refresh.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No models match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {filtered.map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() => onChange(model.id)}
              className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-[3/4] ${
                value === model.id
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-transparent hover:border-border"
              }`}
            >
              {model.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={model.thumbnailUrl}
                  alt={model.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center text-2xl">
                  👤
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1.5">
                <div className="text-white text-[9px] font-medium leading-tight">{model.name}</div>
                <div className="text-white/70 text-[8px] leading-tight capitalize">{model.style}</div>
              </div>
              {value === model.id && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                  <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white fill-current">
                    <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
