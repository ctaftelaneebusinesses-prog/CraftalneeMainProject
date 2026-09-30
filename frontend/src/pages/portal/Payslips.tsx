import { motion } from "motion/react";
import { Receipt } from "lucide-react";
import { inr, monthLabel } from "@/lib/format";
import { Card, EmptyState, FileActions, PageHeader, PageSkeleton } from "@/components/ui/core";
import { Sparkline } from "@/components/charts";
import { useMe } from "./useMe";

export default function PortalPayslips() {
  const { data, isLoading } = useMe();
  if (isLoading || !data) return <PageSkeleton />;
  const slips = data.payslips;
  const trend = [...slips].reverse().map((p) => ({ month: p.month, label: monthLabel(p.month, true), income: p.net, expenses: 0, balance: p.net }));
  const ytd = slips.filter((p) => p.month.startsWith(String(new Date().getFullYear()))).reduce((s, p) => s + p.net, 0);

  return (
    <>
      <PageHeader eyebrow="My payslips" title="Payslips" subtitle={`${slips.length} payslip${slips.length === 1 ? "" : "s"}`} />
      {slips.length === 0 ? <Card><EmptyState icon={<Receipt />} title="No payslips yet" text="Your payslips will appear here each month once payroll is processed." /></Card> : (<>
        <Card glow className="p-6 mb-5 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 items-center">
          <div>
            <div className="text-[12.5px] text-fg-3">Earned this year</div>
            <div className="font-display text-[32px] font-bold text-grad tnum">{inr(ytd)}</div>
          </div>
          {trend.length > 1 && <Sparkline data={trend} height={70} color="#34d399" />}
        </Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {slips.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Card hover className="group relative overflow-hidden p-5">
                <div className="absolute -right-10 -top-10 size-28 rounded-full bg-good/15 blur-2xl opacity-50 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-start justify-between">
                  <div>
                    <div className="font-display font-semibold text-[16px]">{monthLabel(p.month)}</div>
                    <div className="font-mono text-[11.5px] text-fg-4 mt-0.5">{p.number}</div>
                  </div>
                  <span className="grid place-items-center size-10 rounded-xl bg-good/10 text-good border border-white/[0.07]"><Receipt className="size-[18px]" /></span>
                </div>
                <div className="relative mt-5 text-[12px] text-fg-3">Net salary</div>
                <div className="relative font-display text-[26px] font-bold tnum">{inr(p.net)}</div>
                <div className="relative mt-4 pt-3 border-t divider flex justify-end"><FileActions url={p.file_url} /></div>
              </Card>
            </motion.div>
          ))}
        </div>
      </>)}
    </>
  );
}
