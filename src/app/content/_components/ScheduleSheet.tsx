"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader,
  SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import FormField from "@/components/app/FormField";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { apiGet } from "@/lib/api-client";

type SmartSlot = {
  day: number;
  dayName: string;
  hour: number;
  label: string;
  score: number;
  reason: string;
  suggestedDate: string;
};

function ScoreBadge({ score }: { score: number }) {
  const style: React.CSSProperties =
    score >= 90
      ? {
          background: "color-mix(in oklch, var(--mk-pos) 14%, var(--mk-paper))",
          color: "color-mix(in oklch, var(--mk-pos) 60%, var(--mk-ink))",
          borderColor: "color-mix(in oklch, var(--mk-pos) 26%, var(--mk-rule))",
        }
      : score >= 80
        ? {
            background: "var(--mk-accent-soft)",
            color: "var(--mk-accent)",
            borderColor: "color-mix(in oklch, var(--mk-accent) 26%, var(--mk-rule))",
          }
        : {
            background: "var(--mk-panel)",
            color: "var(--mk-ink-60)",
            borderColor: "var(--mk-rule)",
          };
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
      style={style}
    >
      {score}%
    </span>
  );
}

export default function ScheduleSheet({
  open,
  onOpenChange,
  onSchedule,
  channel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (date: string) => void;
  channel?: string;
}) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("12:00");
  const [selectedSuggestionIso, setSelectedSuggestionIso] = useState<string | null>(null);
  const [smartSlots, setSmartSlots] = useState<SmartSlot[]>([]);
  const [smartLoaded, setSmartLoaded] = useState(false);
  const [showSmart, setShowSmart] = useState(true);

  const handleSheetOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedDate(undefined);
      setTime("12:00");
      setSelectedSuggestionIso(null);
      setSmartSlots([]);
      setSmartLoaded(false);
      setShowSmart(true);
    }
    onOpenChange(nextOpen);
  };

  // Fetch smart schedule suggestions when sheet opens
  useEffect(() => {
    if (!open) return;
    const query = channel ? `?channel=${channel}` : "";
    apiGet<{ suggestions: Record<string, SmartSlot[]> }>(`/api/posts/smart-schedule${query}`)
      .then((res) => {
        if (res.ok) {
          const ch = channel || "instagram";
          const slots = res.data.suggestions[ch] || [];
          setSmartSlots(slots);
        }
      })
      .catch(() => {})
      .finally(() => setSmartLoaded(true));
  }, [open, channel]);

  const handleSchedule = () => {
    if (!selectedDate) return;
    if (selectedSuggestionIso) {
      onSchedule(selectedSuggestionIso);
      onOpenChange(false);
      return;
    }
    const [hours, minutes] = time.split(":").map(Number);
    const scheduled = new Date(selectedDate);
    scheduled.setHours(hours, minutes, 0, 0);
    onSchedule(scheduled.toISOString());
    onOpenChange(false);
  };

  const handleSmartPick = (slot: SmartSlot) => {
    const d = new Date(slot.suggestedDate);
    setSelectedDate(d);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    setTime(`${h}:${m}`);
    setSelectedSuggestionIso(slot.suggestedDate);
    setShowSmart(false);
  };

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader
          className="px-6 pt-6 pb-4 border-b"
          style={{ borderColor: "var(--mk-rule)" }}
        >
          <p className="mk-eyebrow">Schedule</p>
          <SheetTitle
            className="text-[22px] font-semibold m-0"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.025em" }}
          >
            Schedule post
          </SheetTitle>
          <SheetDescription
            className="text-[13px]"
            style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
          >
            Pick a date and time, or use AI-suggested optimal slots.
          </SheetDescription>
        </SheetHeader>

        {channel === "tiktok" && (
          <div
            className="mx-6 mt-2 rounded-lg px-3 py-2 text-[12px]"
            style={{
              background: "color-mix(in oklch, var(--mk-warn) 14%, var(--mk-paper))",
              border: "1px solid color-mix(in oklch, var(--mk-warn) 28%, var(--mk-rule))",
              color: "color-mix(in oklch, var(--mk-warn) 70%, var(--mk-ink))",
            }}
          >
            <span className="font-medium">TikTok finishes in the TikTok app.</span>{" "}
            At the scheduled time, Markaestro pushes the media to your TikTok inbox, then marks it ready once you can open TikTok to finish caption, privacy, and posting.
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Smart Scheduling Suggestions */}
          {smartSlots.length > 0 && (
            <div>
              <button
                onClick={() => setShowSmart(!showSmart)}
                className="flex items-center gap-2 w-full text-left mb-3"
              >
                <span className="text-sm font-semibold text-foreground">Smart Schedule</span>
                <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-medium">
                  AI Suggested
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {showSmart ? "Hide" : "Show"}
                </span>
              </button>

              {showSmart && (
                <div className="space-y-2">
                  {!smartLoaded ? (
                    <div className="flex items-center justify-center py-6">
                      <div className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    </div>
                  ) : (
                    <>
                      {smartSlots.slice(0, 4).map((slot, i) => (
                        <button
                          key={i}
                          onClick={() => handleSmartPick(slot)}
                          className="w-full flex items-center gap-3 rounded-xl border border-border/40 bg-background p-3 hover:border-primary/30 hover:bg-primary/[0.02] transition-all text-left group"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground">
                                {new Date(slot.suggestedDate).toLocaleString([], {
                                  weekday: "long",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </p>
                              <ScoreBadge score={slot.score} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{slot.reason}</p>
                          </div>
                        </button>
                      ))}
                      <p className="text-[10px] text-muted-foreground text-center pt-1">
                        Based on industry engagement data for {channel || "this channel"}
                      </p>
                    </>
                  )}
                </div>
              )}

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-background px-3 text-muted-foreground">or pick manually</span>
                </div>
              </div>
            </div>
          )}

          {/* Manual date/time picker */}
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              setSelectedDate(date);
              setSelectedSuggestionIso(null);
            }}
            disabled={{ before: new Date() }}
          />
          <FormField label="Time">
            <Input
              type="time"
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                setSelectedSuggestionIso(null);
              }}
            />
          </FormField>
        </div>

        <SheetFooter>
          <Button onClick={handleSchedule} disabled={!selectedDate} className="w-full">
            {selectedDate
              ? `Schedule for ${selectedDate.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`
              : "Select a date"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
