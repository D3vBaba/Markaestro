"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader,
  SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import FormField from "@/components/app/FormField";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

export default function ScheduleSheet({
  open,
  onOpenChange,
  onSchedule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (date: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("12:00");

  const handleSchedule = () => {
    if (!selectedDate) return;
    const [hours, minutes] = time.split(":").map(Number);
    const scheduled = new Date(selectedDate);
    scheduled.setHours(hours, minutes, 0, 0);
    onSchedule(scheduled.toISOString());
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Schedule Post</SheetTitle>
          <SheetDescription>Pick a date and time to publish.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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
          <Button onClick={handleSchedule} disabled={!selectedDate}>
            Schedule
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
