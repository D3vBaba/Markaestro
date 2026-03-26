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
import { cn } from "@/lib/utils";

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
  const color =
    score >= 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    score >= 80 ? "bg-blue-50 text-blue-700 border-blue-200" :
    "bg-muted text-muted-foreground border-border/40";
  return (
    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", color)}>
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
  const [smartSlots, setSmartSlots] = useState<SmartSlot[]>([]);
  const [loadingSmart, setLoadingSmart] = useState(false);
  const [showSmart, setShowSmart] = useState(true);

  // Fetch smart schedule suggestions when sheet opens
  useEffect(() => {
    if (!open) return;
    setLoadingSmart(true);
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
      .finally(() => setLoadingSmart(false));
  }, [open, channel]);

  const handleSchedule = () => {
    if (!selectedDate) return;
    const [hours, minutes] = time.split(":").map(Number);
    const scheduled = new Date(selectedDate);
    scheduled.setHours(hours, minutes, 0, 0);
    onSchedule(scheduled.toISOString());
    onOpenChange(false);
  };

  const handleSmartPick = (slot: SmartSlot) => {
    const d = new Date(slot.suggestedDate);
    setSelectedDate(d);
    const h = d.getUTCHours().toString().padStart(2, "0");
    setTime(`${h}:00`);
    setShowSmart(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Schedule Post</SheetTitle>
          <SheetDescription>Pick a date and time, or use AI-suggested optimal slots.</SheetDescription>
        </SheetHeader>

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
                  {loadingSmart ? (
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
                              <p className="text-sm font-medium text-foreground">{slot.label}</p>
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
            onSelect={setSelectedDate}
            disabled={{ before: new Date() }}
          />
          <FormField label="Time">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
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
