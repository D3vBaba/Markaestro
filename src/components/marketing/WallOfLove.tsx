"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Star, Quote, CheckCircle2 } from "lucide-react";
import testimonials from "@/content/testimonials.json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Testimonial = {
  verified?: boolean;
  quote: string;
  name: string;
  role: string;
  company: string;
  metric?: string;
  badge?: string;
  stars?: number;
};

export default function WallOfLove({ title }: { title: string }) {
  const items = ((testimonials.items as Testimonial[]) ?? []).filter((item) => item.verified === true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 1 card on mobile, 2 on tablet, 3 on desktop
  const getVisibleCount = () => {
    if (typeof window === "undefined") return 3;
    if (window.innerWidth < 640) return 1;
    if (window.innerWidth < 1024) return 2;
    return 3;
  };

  const [visibleCount, setVisibleCount] = useState(3);

  useEffect(() => {
    const handleResize = () => setVisibleCount(getVisibleCount());
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const maxIndex = Math.max(0, items.length - visibleCount);

  const nextSlide = () => {
    setCurrentIndex((prev) => (prev >= maxIndex ? 0 : prev + 1));
  };

  const prevSlide = () => {
    setCurrentIndex((prev) => (prev <= 0 ? maxIndex : prev - 1));
  };

  // Autoplay with pause on hover
  useEffect(() => {
    if (isPaused || maxIndex === 0) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev >= maxIndex ? 0 : prev + 1));
    }, 5500);
    return () => clearInterval(interval);
  }, [isPaused, maxIndex]);

  if (items.length === 0) return null;

  return (
    <section className="relative border-t border-border bg-card/40 py-20 sm:py-28 overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* Header & Controls Row */}
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row md:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-mk-accent/30 bg-mk-accent-soft px-3.5 py-1 text-xs font-bold text-mk-accent">
              <span className="flex text-amber-500">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="size-3 fill-amber-400 text-amber-400" />
                ))}
              </span>
              <span>Customer stories</span>
            </div>
            <h2 className="m-0 mt-3 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-[42px]">
              {title}
            </h2>
            <p className="m-0 mt-2 max-w-xl text-sm leading-relaxed text-mk-ink-80 sm:text-base">
              Discover how marketing teams, agencies, and founders use Markaestro to scale their social reach with evidence.
            </p>
          </div>

          {/* Carousel Buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={prevSlide}
              className="size-10 rounded-full border-border bg-background hover:bg-muted"
              aria-label="Previous review"
            >
              <ChevronLeft className="size-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={nextSlide}
              className="size-10 rounded-full border-border bg-background hover:bg-muted"
              aria-label="Next review"
            >
              <ChevronRight className="size-5" />
            </Button>
          </div>
        </div>

        {/* Carousel Viewport */}
        <div
          ref={containerRef}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          className="mt-12 overflow-hidden"
        >
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{
              transform: `translateX(-${currentIndex * (100 / visibleCount)}%)`,
            }}
          >
            {items.map((item, index) => {
              const initials = item.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2);

              return (
                <div
                  key={`${item.name}-${index}`}
                  className="shrink-0 px-2.5"
                  style={{ width: `${100 / visibleCount}%` }}
                >
                  <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-sm transition-all duration-200 hover:shadow-md hover:border-mk-accent/30">
                    <div>
                      {/* Top Row: Stars and Metric */}
                      <div className="flex items-center justify-between">
                        <div className="flex text-amber-400">
                          {[...Array(item.stars ?? 5)].map((_, i) => (
                            <Star key={i} className="size-4 fill-amber-400 text-amber-400" />
                          ))}
                        </div>
                        {item.metric && (
                          <Badge variant="outline" className="text-[11px] font-bold font-mono text-mk-accent border-mk-accent/30 bg-mk-accent-soft/50">
                            {item.metric}
                          </Badge>
                        )}
                      </div>

                      {/* Quote */}
                      <div className="relative mt-4">
                        <Quote className="absolute -left-1 -top-2 size-6 text-muted-foreground/15 -z-0" />
                        <blockquote className="relative z-10 m-0 text-[14px] leading-relaxed text-foreground">
                          &quot;{item.quote}&quot;
                        </blockquote>
                      </div>
                    </div>

                    {/* Reviewer Metadata */}
                    <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
                      <div className="flex items-center gap-3">
                        <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white shadow-sm">
                          {initials}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-foreground">{item.name}</span>
                            <CheckCircle2 className="size-3 text-mk-pos" />
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {item.role}, {item.company}
                          </p>
                        </div>
                      </div>

                      {item.badge && (
                        <span className="hidden text-[10px] font-semibold text-muted-foreground sm:inline-block">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Carousel Pagination Dots */}
        <div className="mt-8 flex items-center justify-center gap-1.5">
          {Array.from({ length: maxIndex + 1 }).map((_, dotIdx) => (
            <button
              key={dotIdx}
              onClick={() => setCurrentIndex(dotIdx)}
              type="button"
              className={cn(
                "h-2 rounded-full transition-all duration-300",
                currentIndex === dotIdx
                  ? "w-6 bg-mk-accent"
                  : "w-2 bg-muted hover:bg-muted-foreground/50"
              )}
              aria-label={`Go to slide ${dotIdx + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
