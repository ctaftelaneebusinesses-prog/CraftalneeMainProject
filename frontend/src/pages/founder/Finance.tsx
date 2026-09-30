import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, BarChart3, Minus, PieChart, Scale, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { api, qs } from "@/lib/api";
import { cn, fmtDate, inr } from "@/lib/format";
import type { CategoryAmount, Expense, Income, Period, Totals, TrendPoint } from "@/lib/types";
import { AnimatedNumber, Badge, Button, Card, CardHeader, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/core";
import { Bars, CATEGORY_COLORS, Donut } from "@/components/charts";
import { PeriodPicker, type PeriodValue } from "@/components/PeriodPicker";

interface Summary { period: Period; overall: Totals; totals: Totals; categories: CategoryAmount[]; trend: TrendPoint[]; recent_income: Income[]; recent_expenses: Expense[] }

export default function Finance() {
  const [p, setP] = useState<PeriodValue>({ period: "this_month", start: "", end: "" });
  const { data, isLoading } = useQuery({
    queryKey: ["finance", p],
    queryFn: () => api.get<Summary>(`/finance/summary${qs(p.period === "custom" ? p : { period: p.period })}`),
    placeholderData: keepPreviousData,
  });
  if (isLoading || !data) return <PageSkeleton />;
  const { overall: o, totals: t } = data;
  const spent = data.categories.reduce((s, c) => s + c.amount, 0);
  const periodQs = qs(p.period === "custom" ? p : { period: p.period });

  return (
    <>
      <PageHeader eyebrow="Finance" title="Balance" subtitle="Current balance = received income − all expenses (finalised payroll included)."
        actions={<><Button icon={<TrendingDown />} to="/finance/expenses?new=1">Add expense</Button><Button variant="primary" icon={<TrendingUp />} to="/finance/income?new=1">Add income</Button></>} />

      {/* equation hero */}
      <Card glow className="relative overflow-hidden p-6 sm:p-8 mb-6">
        <div className="absolute -left-20 -top-24 size-72 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -right-10 -bottom-24 size-72 rounded-full bg-flame-500/15 blur-3xl" />
        <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1.2fr] items-center gap-5 md:gap-3">
          <Eq label="Total income" sub={o.pending_income ? `${inr(o.pending_income)} pending (not counted)` : "Received, all time"} value={o.income} icon={<ArrowUpRight />} tone="text-good" />
          <Op><Minus /></Op>
          <Eq label="Total expenses" sub={`incl. ${inr(o.payroll)} payroll`} value={o.expenses} icon={<ArrowDownRight />} tone="text-bad" />
          <Op>=</Op>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-2 text-[12.5px] text-fg-3"><Scale className="size-4 text-brand-300" /> Current balance</div>
            <div className={cn("font-display text-[38px] leading-tight font-extrabold mt-1", o.balance < 0 ? "text-bad" : "text-grad")}><AnimatedNumber value={o.balance} /></div>
            <Badge tone={o.balance >= 0 ? "good" : "bad"} dot className="mt-1">{o.balance >= 0 ? "Healthy" : "In deficit"}</Badge>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-[20px] font-semibold">{data.period.label}</h2>
        <PeriodPicker value={p} onChange={setP} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {[
          { label: "Income", v: t.income, cls: "text-good" },
          { label: "Payroll", v: t.payroll, cls: "text-flame-400" },
          { label: "Other expenses", v: t.other_expenses, cls: "text-fg" },
          { label: "Total expenses", v: t.expenses, cls: "text-bad" },
          { label: "Balance", v: t.balance, cls: t.balance < 0 ? "text-bad" : "text-grad" },
        ].map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Card className={cn("p-4 h-full", i === 4 && "col-span-2 lg:col-span-1")}>
              <div className="text-[12px] text-fg-3">{k.label}</div>
              <div className={cn("font-display font-bold text-[20px] mt-1 tnum", k.cls)}>{inr(k.v)}</div>
            </Card>
          </motion.div>
        ))}
      </div>
      {t.pending_income > 0 && <p className="-mt-2 mb-5 text-[12.5px] text-fg-4">{inr(t.pending_income)} of income in this period is pending and not yet counted.</p>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2">
          <CardHeader icon={<BarChart3 />} title="Monthly cash flow" subtitle="Last 12 months" />
          <div className="px-3 pb-4"><Bars data={data.trend} height={280} /></div>
        </Card>
        <Card>
          <CardHeader icon={<PieChart />} title="Expenses by category" subtitle={data.period.label} />
          {data.categories.length ? (
            <div className="px-6 pb-6">
              <Donut data={data.categories} height={180} center={<div><div className="text-[11px] text-fg-4 uppercase tracking-wider">Total</div><div className="font-display font-bold text-[18px] tnum">{inr(spent)}</div></div>} />
              <div className="mt-5 space-y-3">
                {data.categories.map((c, i) => (
                  <div key={c.category}>
                    <div className="flex justify-between text-[13px] mb-1"><span className="flex items-center gap-2 text-fg-2"><span className="size-2 rounded-full" style={{ background: CATEGORY_COLORS[i % 8] }} />{c.category}</span><span className="tnum">{inr(c.amount)}</span></div>
                    <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden"><motion.div className="h-full rounded-full" style={{ background: CATEGORY_COLORS[i % 8] }} initial={{ width: 0 }} animate={{ width: `${(c.amount / spent) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.05 }} /></div>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyState icon={<Wallet />} title="No expenses" text="Nothing spent in this period." />}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MiniList title="Income" icon={<TrendingUp />} to={`/finance/income${periodQs}`} empty="No income in this period."
          rows={data.recent_income.map((r) => ({ id: r.id, title: r.source, sub: `${fmtDate(r.date)}${r.client ? ` · ${r.client}` : ""}`, amount: r.amount, badge: r.payment_status !== "Received" ? r.payment_status : null, positive: true }))} />
        <MiniList title="Expenses" icon={<TrendingDown />} to={`/finance/expenses${periodQs}`} empty="No expenses in this period."
          rows={data.recent_expenses.map((r) => ({ id: r.id, title: r.description, sub: `${fmtDate(r.date)} · ${r.category}`, amount: r.amount, badge: r.is_payroll ? "Payroll" : null, positive: false }))} />
      </div>
    </>
  );
}

function Eq({ label, sub, value, icon, tone }: { label: string; sub: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[12.5px] text-fg-3"><span className={cn("[&>svg]:size-4", tone)}>{icon}</span>{label}</div>
      <div className="font-display text-[28px] font-bold mt-1"><AnimatedNumber value={value} /></div>
      <div className="text-[12px] text-fg-4">{sub}</div>
    </div>
  );
}
function Op({ children }: { children: React.ReactNode }) {
  return <div className="hidden md:grid place-items-center size-10 rounded-full border border-white/10 bg-white/[0.03] text-fg-3 text-[18px] font-light [&>svg]:size-4">{children}</div>;
}

function MiniList({ title, icon, to, rows, empty }: { title: string; icon: React.ReactNode; to: string; empty: string; rows: { id: number; title: string; sub: string; amount: number; badge: string | null; positive: boolean }[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={icon} title={title} action={<Link to={to} className="text-[12.5px] text-fg-3 hover:text-fg">View all</Link>} />
      <div className="border-t divider divide-y divide-white/[0.05]">
        {rows.length ? rows.map((r) => (
          <div key={r.id} className="flex items-center gap-4 px-6 py-3.5">
            <span className={cn("grid place-items-center size-9 rounded-xl border border-white/[0.07]", r.positive ? "bg-good/10 text-good" : "bg-bad/10 text-bad")}>{r.positive ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}</span>
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{r.title}</div><div className="text-[12.5px] text-fg-3 truncate">{r.sub}</div></div>
            {r.badge && <Badge tone={r.badge === "Payroll" ? "brand" : "warn"}>{r.badge}</Badge>}
            <span className="tnum font-semibold">{inr(r.amount)}</span>
          </div>
        )) : <div className="px-6 py-8 text-center text-[13px] text-fg-4">{empty}</div>}
      </div>
    </Card>
  );
}
