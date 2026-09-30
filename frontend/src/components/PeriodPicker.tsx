import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button, Segmented } from "@/components/ui/core";

export type PeriodKey = "this_month" | "last_month" | "this_year" | "all" | "custom";
export interface PeriodValue { period: PeriodKey; start: string; end: string }

export function PeriodPicker({ value, onChange, withAll = true }: { value: PeriodValue; onChange: (v: PeriodValue) => void; withAll?: boolean }) {
  const [start, setStart] = useState(value.start);
  const [end, setEnd] = useState(value.end);
  const opts: { value: PeriodKey; label: string }[] = [
    { value: "this_month", label: "This month" }, { value: "last_month", label: "Last month" }, { value: "this_year", label: "This year" },
    ...(withAll ? [{ value: "all" as PeriodKey, label: "All time" }] : []), { value: "custom", label: "Custom" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented layoutId="period" value={value.period} onChange={(p) => onChange({ ...value, period: p })} options={opts} />
      {value.period === "custom" && (
        <div className="flex items-center gap-2">
          <CalendarRange className="size-4 text-fg-4" />
          <input type="date" className="input input-sm h-[38px] w-[150px]" value={start} onChange={(e) => setStart(e.target.value)} aria-label="From" />
          <span className="text-fg-4">→</span>
          <input type="date" className="input input-sm h-[38px] w-[150px]" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="To" />
          <Button size="sm" onClick={() => onChange({ period: "custom", start, end })}>Apply</Button>
        </div>
      )}
    </div>
  );
}
