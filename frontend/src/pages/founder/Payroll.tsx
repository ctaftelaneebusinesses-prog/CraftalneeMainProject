import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, CalendarPlus, CheckCircle2, Clock3, Receipt, Users, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { cn, inr, monthLabel, thisMonth } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/core";

interface MonthSummary { month: string; label: string; count: number; total: number; drafts: number; payslips: number }

export default function Payroll() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const { data, isLoading } = useQuery({ queryKey: ["payroll"], queryFn: () => api.get<{ months: MonthSummary[]; active_count: number; monthly_total: number }>("/payroll") });
  const create = useMutation({
    mutationFn: () => api.post<{ month: string; added: number }>("/payroll", { month }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(r.added ? `Draft created for ${r.added} employee${r.added === 1 ? "" : "s"}` : "This month already includes every active employee");
      navigate(`/payroll/${r.month}`);
    },
  });
  if (isLoading || !data) return <PageSkeleton />;

  return (
    <>
      <PageHeader eyebrow="Payroll" title="Payroll" subtitle="Create a month → review amounts → finalise. Salaries post to expenses and payslips generate automatically." />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 items-start">
        <div className="space-y-3">
          {data.months.length === 0 ? (
            <Card><EmptyState icon={<Wallet />} title="No payroll yet" text="Create your first payroll month using the panel on the right." /></Card>
          ) : data.months.map((m, i) => {
            const done = m.drafts === 0;
            const slipPct = m.count ? (m.payslips / m.count) * 100 : 0;
            return (
              <motion.div key={m.month} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Link to={`/payroll/${m.month}`}>
                  <Card hover className="group flex flex-wrap items-center gap-5 p-5">
                    <div className={cn("grid place-items-center size-14 rounded-2xl border border-white/[0.08] font-display", done ? "bg-gradient-to-br from-good/20 to-transparent" : "bg-gradient-to-br from-warn/20 to-transparent")}>
                      <div className="text-center leading-none">
                        <div className="text-[10.5px] uppercase tracking-wider text-fg-3">{monthLabel(m.month, true).split(" ")[0]}</div>
                        <div className="text-[15px] font-bold mt-1">{m.month.slice(0, 4)}</div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <div className="flex items-center gap-2"><span className="font-display font-semibold text-[16px]">{m.label}</span>
                        {done ? <Badge tone="good" dot>Finalised</Badge> : m.drafts === m.count ? <Badge tone="warn" dot>Draft</Badge> : <Badge tone="info" dot>Partly finalised</Badge>}</div>
                      <div className="flex items-center gap-4 mt-1.5 text-[12.5px] text-fg-3">
                        <span className="flex items-center gap-1.5"><Users className="size-3.5" />{m.count} employees</span>
                        <span className="flex items-center gap-1.5"><Receipt className="size-3.5" />{m.payslips}/{m.count} payslips</span>
                      </div>
                      <div className="mt-2.5 h-1 w-full max-w-[260px] rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-good/70" style={{ width: `${slipPct}%` }} /></div>
                    </div>
                    <div className="text-right">
                      <div className="text-[12px] text-fg-4">Net payable</div>
                      <div className="font-display font-bold text-[20px] tnum">{inr(m.total)}</div>
                    </div>
                    <ArrowRight className="size-5 text-fg-4 group-hover:text-fg group-hover:translate-x-1 transition-all" />
                  </Card>
                </Link>
              </motion.div>
            );
          })}
        </div>

        <Card glow className="relative overflow-hidden p-6 xl:sticky xl:top-24">
          <div className="absolute -right-16 -top-16 size-48 rounded-full bg-brand-500/25 blur-3xl" />
          <div className="relative">
            <span className="grid place-items-center size-11 rounded-xl text-on-accent" style={{ background: "var(--grad)" }}><CalendarPlus className="size-5" /></span>
            <h3 className="font-display text-[18px] font-semibold mt-4">Run payroll</h3>
            <p className="text-[13px] text-fg-3 mt-1">A draft row is created for every active employee using their current salary.</p>
            <label className="field-label mt-5">Month</label>
            <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"><div className="text-[11.5px] text-fg-4">Active employees</div><div className="font-semibold mt-0.5">{data.active_count}</div></div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"><div className="text-[11.5px] text-fg-4">Est. payroll</div><div className="font-semibold mt-0.5 tnum">{inr(data.monthly_total)}</div></div>
            </div>
            <Button variant="primary" className="w-full mt-5 h-11" icon={<ArrowRight />} loading={create.isPending} disabled={!month} onClick={() => create.mutate()}>Create {monthLabel(month)} draft</Button>
            <div className="mt-5 space-y-2.5 text-[12.5px] text-fg-3">
              {[[Clock3, "Edit allowances, bonus & deductions"], [CheckCircle2, "Finalise → posts one Salary expense"], [Receipt, "Payslips land in each profile"]].map(([Icon, t], i) => {
                const I = Icon as typeof Clock3;
                return <div key={i} className="flex items-center gap-2.5"><I className="size-4 text-brand-300" />{t as string}</div>;
              })}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
