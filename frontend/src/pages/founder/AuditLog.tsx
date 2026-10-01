import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, ChevronLeft, ChevronRight, FileText, PhoneCall, Settings2, TrendingUp, Users, Wallet } from "lucide-react";
import { api, qs } from "@/lib/api";
import { capitalize, fmtDate } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";
import { Button, Card, EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui/core";

const ICONS: Record<string, typeof Activity> = { employee: Users, document: FileText, payroll: Wallet, finance: TrendingUp, followup: PhoneCall, settings: Settings2 };
type Cat = "" | "employee" | "document" | "payroll" | "finance" | "followup" | "settings";

export default function AuditLog() {
  const [category, setCategory] = useState<Cat>("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["audit", category, page],
    queryFn: () => api.get<{ entries: AuditEntry[]; page: number; has_next: boolean }>(`/audit${qs({ category, page })}`),
    placeholderData: keepPreviousData,
  });
  const groups: Record<string, AuditEntry[]> = {};
  (data?.entries ?? []).forEach((e) => { const d = fmtDate(e.created_at, { weekday: "long", day: "numeric", month: "long", year: "numeric" }); (groups[d] ??= []).push(e); });

  return (
    <>
      <PageHeader back={{ to: "/settings", label: "Settings" }} eyebrow="Security" title="Audit log" subtitle="Who did what, and when." />
      <div className="mb-5">
        <Segmented layoutId="audit-cat" value={category} onChange={(c) => { setCategory(c); setPage(1); }} options={[
          { value: "", label: "All" }, { value: "employee", label: "Employees" }, { value: "document", label: "Documents" },
          { value: "payroll", label: "Payroll" }, { value: "finance", label: "Finance" }, { value: "followup", label: "Follow-ups" }, { value: "settings", label: "Settings" },
        ]} />
      </div>
      <Card className="p-6 sm:p-8">
        {isLoading ? <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : !data?.entries.length ? <EmptyState icon={<Activity />} title="No entries" />
          : Object.entries(groups).map(([day, items]) => (
            <div key={day} className="mb-8 last:mb-0">
              <div className="eyebrow mb-4">{day}</div>
              <ol className="relative">
                <span className="absolute left-[17px] top-2 bottom-2 w-px bg-white/[0.07]" />
                {items.map((a) => {
                  const Icon = ICONS[a.category ?? ""] ?? Activity;
                  return (
                    <li key={a.id} className="relative flex gap-4 pb-5 last:pb-0">
                      <span className="relative z-10 grid place-items-center size-9 rounded-xl border border-white/[0.08] bg-ink-800 text-fg-3"><Icon className="size-4" /></span>
                      <div className="flex-1 min-w-0 pt-1.5">
                        <div className="text-[13.5px]"><span className="font-semibold">{a.user_name}</span> <span className="text-fg-2">{a.action}</span></div>
                        {a.details && <div className="text-[12.5px] text-fg-4 mt-0.5">{a.details}</div>}
                      </div>
                      <div className="pt-1.5 text-right shrink-0">
                        <div className="text-[12.5px] text-fg-3 tnum">{new Date(a.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
                        {a.category && <div className="text-[11px] text-fg-4">{capitalize(a.category)}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
      </Card>
      <div className="flex justify-end gap-2 mt-4">
        <Button size="sm" icon={<ChevronLeft />} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
        <Button size="sm" disabled={!data?.has_next} onClick={() => setPage((p) => p + 1)}>Older <ChevronRight /></Button>
      </div>
    </>
  );
}
