"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ImageIcon,
  Send,
} from "lucide-react";
import { ChannelGlyph } from "@/components/app/ChannelGlyph";

type ShowcaseKind = "composer" | "calendar" | "intelligence";

export type ShowcaseSlide = {
  id: string;
  kind: ShowcaseKind;
  eyebrow: string;
  title: string;
  description: string;
};

type ComposerRow = { label: string; value: string };
type IntelligenceItem = { title: string; desc: string };

const channelProviders = ["instagram", "meta", "tiktok", "linkedin", "threads", "pinterest", "x"];

function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#f8fafc] shadow-2xl shadow-black/30">
      <div className="flex h-9 items-center gap-1.5 border-b border-slate-200 bg-white px-4">
        <span className="h-2 w-2 rounded-full bg-[#fb7185]" />
        <span className="h-2 w-2 rounded-full bg-[#fbbf24]" />
        <span className="h-2 w-2 rounded-full bg-[#34d399]" />
        <span className="ml-3 h-1.5 w-24 rounded-full bg-slate-200" />
      </div>
      {children}
    </div>
  );
}

function ComposerPreview({ rows }: { rows: ComposerRow[] }) {
  return (
    <PreviewShell>
      <div className="grid min-h-[330px] gap-4 p-4 sm:grid-cols-[1.15fr_0.85fr] sm:p-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Send className="h-3.5 w-3.5 text-blue-600" />
              {rows[1]?.label}
            </div>
            <div className="flex -space-x-1.5">
              {channelProviders.slice(0, 4).map((provider) => (
                <span key={provider} className="rounded-lg ring-2 ring-white">
                  <ChannelGlyph provider={provider} size={25} className="rounded-lg" />
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="block h-2 w-full rounded-full bg-slate-200" />
            <span className="block h-2 w-[92%] rounded-full bg-slate-200" />
            <span className="block h-2 w-[68%] rounded-full bg-slate-200" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="grid aspect-[4/3] place-items-center rounded-lg bg-gradient-to-br from-blue-100 via-indigo-100 to-fuchsia-100">
              <ImageIcon className="h-7 w-7 text-blue-600" />
            </div>
            <div className="grid aspect-[4/3] place-items-center rounded-lg bg-gradient-to-br from-orange-100 via-rose-100 to-pink-100">
              <ImageIcon className="h-7 w-7 text-rose-500" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
              <Clock3 className="h-3 w-3" />
              {rows[2]?.label}
            </div>
            <span className="rounded-md bg-blue-600 px-3 py-1.5 text-[10px] font-semibold text-white">
              {rows[2]?.value.split(" ").slice(0, 2).join(" ")}
            </span>
          </div>
        </div>

        <div className="hidden flex-col gap-3 sm:flex">
          {channelProviders.slice(0, 3).map((provider, index) => (
            <div key={provider} className="flex-1 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <ChannelGlyph provider={provider} size={24} className="rounded-md" />
                <span className="h-1.5 w-16 rounded-full bg-slate-200" />
              </div>
              <div className="mt-3 flex gap-2">
                <div
                  className={`h-12 w-12 shrink-0 rounded-md ${
                    index === 0
                      ? "bg-gradient-to-br from-blue-200 to-fuchsia-200"
                      : index === 1
                        ? "bg-gradient-to-br from-orange-200 to-rose-200"
                        : "bg-gradient-to-br from-cyan-200 to-blue-200"
                  }`}
                />
                <div className="flex-1 space-y-1.5 pt-1">
                  <span className="block h-1.5 w-full rounded-full bg-slate-200" />
                  <span className="block h-1.5 w-[82%] rounded-full bg-slate-200" />
                  <span className="block h-1.5 w-[54%] rounded-full bg-slate-200" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PreviewShell>
  );
}

function CalendarPreview() {
  const posts = [
    { provider: "instagram", column: 1, row: 1, tone: "bg-pink-50 border-pink-200" },
    { provider: "linkedin", column: 3, row: 1, tone: "bg-blue-50 border-blue-200" },
    { provider: "tiktok", column: 2, row: 2, tone: "bg-slate-100 border-slate-300" },
    { provider: "meta", column: 4, row: 2, tone: "bg-sky-50 border-sky-200" },
    { provider: "pinterest", column: 1, row: 3, tone: "bg-red-50 border-red-200" },
    { provider: "threads", column: 3, row: 3, tone: "bg-zinc-100 border-zinc-300" },
  ];

  return (
    <PreviewShell>
      <div className="min-h-[330px] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <CalendarDays className="h-4 w-4 text-blue-600" />
            <span className="h-2 w-28 rounded-full bg-slate-800" />
          </div>
          <div className="flex items-center gap-2">
            <span className="h-7 w-16 rounded-md bg-slate-100" />
            <span className="h-7 w-20 rounded-md bg-blue-600" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {Array.from({ length: 16 }).map((_, index) => (
            <div key={index} className="min-h-[68px] border-b border-r border-slate-100 p-1.5 last:border-r-0">
              <span className="text-[8px] font-medium text-slate-400">{index + 8}:00</span>
            </div>
          ))}
          <div className="pointer-events-none absolute" />
          {posts.map((post) => (
            <div
              key={`${post.provider}-${post.column}-${post.row}`}
              className={`relative z-10 col-span-1 m-1 -mt-[62px] flex h-[54px] items-center gap-2 rounded-lg border p-2 shadow-sm ${post.tone}`}
              style={{ gridColumn: post.column, gridRow: post.row + 1 }}
            >
              <ChannelGlyph provider={post.provider} size={22} className="rounded-md" />
              <div className="min-w-0 flex-1 space-y-1">
                <span className="block h-1.5 w-full rounded-full bg-slate-300/80" />
                <span className="block h-1.5 w-2/3 rounded-full bg-slate-300/60" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PreviewShell>
  );
}

function IntelligencePreview({ items }: { items: IntelligenceItem[] }) {
  return (
    <PreviewShell>
      <div className="grid min-h-[330px] gap-4 p-4 sm:grid-cols-[1.08fr_0.92fr] sm:p-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            {items[1]?.title}
          </div>
          <div className="mt-5 flex h-36 items-end gap-2 rounded-lg bg-slate-50 px-3 pb-3 pt-5">
            {[38, 56, 47, 72, 61, 88, 76, 94].map((height, index) => (
              <motion.span
                key={height + index}
                className="flex-1 rounded-t bg-gradient-to-t from-blue-600 to-indigo-400"
                initial={{ height: 0 }}
                animate={{ height: `${height}%` }}
                transition={{ delay: index * 0.04, duration: 0.45 }}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            {channelProviders.slice(0, 4).map((provider) => (
              <ChannelGlyph key={provider} provider={provider} size={25} className="rounded-lg" />
            ))}
            <span className="h-2 flex-1 rounded-full bg-slate-200" />
          </div>
        </div>

        <div className="hidden flex-col gap-2.5 sm:flex">
          {items.slice(0, 3).map((item, index) => (
            <div
              key={item.title}
              className={`flex-1 rounded-xl border p-3.5 ${
                index === 1
                  ? "border-blue-200 bg-blue-50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-bold ${
                    index === 1 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {index + 1}
                </span>
                <p className="text-[10px] font-semibold leading-tight text-slate-800">{item.title}</p>
              </div>
              <div className="mt-2 space-y-1">
                <span className="block h-1.5 w-full rounded-full bg-slate-200" />
                <span className="block h-1.5 w-3/4 rounded-full bg-slate-200" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PreviewShell>
  );
}

function SlidePreview({
  kind,
  composerRows,
  intelligenceItems,
}: {
  kind: ShowcaseKind;
  composerRows: ComposerRow[];
  intelligenceItems: IntelligenceItem[];
}) {
  if (kind === "composer") return <ComposerPreview rows={composerRows} />;
  if (kind === "calendar") return <CalendarPreview />;
  return <IntelligencePreview items={intelligenceItems} />;
}

export default function ProductShowcaseCarousel({
  slides,
  composerRows,
  intelligenceItems,
}: {
  slides: ShowcaseSlide[];
  composerRows: ComposerRow[];
  intelligenceItems: IntelligenceItem[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotion = useReducedMotion();
  const activeSlide = slides[activeIndex];

  useEffect(() => {
    if (paused || reduceMotion || slides.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [paused, reduceMotion, slides.length]);

  const goTo = (index: number) => {
    setActiveIndex((index + slides.length) % slides.length);
  };

  return (
    <div
      className="relative overflow-hidden rounded-[28px] border border-slate-900/10 bg-[#0b1020] p-3 shadow-[0_28px_80px_-34px_rgba(37,99,235,0.58)] sm:p-5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="pointer-events-none absolute -left-24 -top-28 h-80 w-80 rounded-full bg-blue-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 right-8 h-80 w-80 rounded-full bg-fuchsia-600/20 blur-3xl" />

      <div className="relative flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.06] p-1 scrollbar-hide">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => goTo(index)}
            className={`min-w-max flex-1 rounded-xl px-4 py-2.5 text-left text-[11px] font-semibold transition sm:text-center sm:text-xs ${
              activeIndex === index
                ? "bg-white text-slate-950 shadow-sm"
                : "text-white/60 hover:bg-white/[0.07] hover:text-white"
            }`}
            aria-current={activeIndex === index ? "true" : undefined}
          >
            {slide.eyebrow}
          </button>
        ))}
      </div>

      <div className="relative min-h-[690px] sm:min-h-[460px] lg:min-h-[430px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeSlide.id}
            className="absolute inset-0 grid gap-8 px-3 py-8 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-center lg:px-8"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -20 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div className="max-w-md">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300">
                {activeSlide.eyebrow}
              </p>
              <h2 className="mt-3 text-[28px] font-semibold leading-[1.05] tracking-[-0.035em] text-white sm:text-[34px]">
                {activeSlide.title}
              </h2>
              <p className="mt-4 text-[13px] leading-relaxed text-slate-300 sm:text-[14px]">
                {activeSlide.description}
              </p>
              <div className="mt-6 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goTo(activeIndex - 1)}
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-white/75 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
                  aria-label={slides[(activeIndex - 1 + slides.length) % slides.length].title}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => goTo(activeIndex + 1)}
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-white/75 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
                  aria-label={slides[(activeIndex + 1) % slides.length].title}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <div className="ml-2 flex gap-1.5" aria-hidden>
                  {slides.map((slide, index) => (
                    <span
                      key={slide.id}
                      className={`h-1.5 rounded-full transition-all ${
                        activeIndex === index ? "w-6 bg-blue-400" : "w-1.5 bg-white/25"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <SlidePreview
              kind={activeSlide.kind}
              composerRows={composerRows}
              intelligenceItems={intelligenceItems}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
