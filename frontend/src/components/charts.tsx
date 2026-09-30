import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr, inrShort } from "@/lib/format";
import type { CategoryAmount, TrendPoint } from "@/lib/types";

export const CATEGORY_COLORS = ["#7c5cff", "#ff7a45", "#22d3ee", "#f472b6", "#34d399", "#fbbf24", "#60a5fa", "#a78bfa"];

type TipPayload = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };

function GlassTip({ active, payload, label }: { active?: boolean; payload?: TipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/95 backdrop-blur-md px-3.5 py-2.5 shadow-2xl text-[12.5px]">
      {label && <div className="text-fg-3 mb-1.5">{label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2.5">
          <span className="size-2 rounded-full" style={{ background: p.color ?? (p.payload?.fill as string) }} />
          <span className="text-fg-2 capitalize">{p.name}</span>
          <span className="ml-auto pl-4 font-semibold tnum text-fg">{inr(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({ data, height = 260 }: { data: TrendPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#7c5cff" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gExpense" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff7a45" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#ff7a45" stopOpacity={0} />
          </linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 6" />
        <XAxis dataKey="label" axisLine={false} tickLine={false} dy={8} />
        <YAxis axisLine={false} tickLine={false} tickFormatter={inrShort} width={56} />
        <Tooltip content={<GlassTip />} />
        <Area type="monotone" dataKey="income" name="income" stroke="#9d84ff" strokeWidth={2.5} fill="url(#gIncome)" filter="url(#glow)" activeDot={{ r: 5, strokeWidth: 0, fill: "#b8a6ff" }} animationDuration={1200} />
        <Area type="monotone" dataKey="expenses" name="expenses" stroke="#ff9466" strokeWidth={2.5} fill="url(#gExpense)" activeDot={{ r: 5, strokeWidth: 0, fill: "#ffb592" }} animationDuration={1400} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 200, center }: { data: CategoryAmount[]; height?: number; center?: React.ReactNode }) {
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<GlassTip />} />
          <Pie data={data} dataKey="amount" nameKey="category" innerRadius="70%" outerRadius="96%" paddingAngle={3} stroke="none" cornerRadius={6} animationDuration={1100}>
            {data.map((_, i) => <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {center && <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">{center}</div>}
    </div>
  );
}

export function Bars({ data, height = 220 }: { data: TrendPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barGap={4}>
        <defs>
          <linearGradient id="bIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9d84ff" /><stop offset="100%" stopColor="#6843f5" /></linearGradient>
          <linearGradient id="bExpense" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffb592" /><stop offset="100%" stopColor="#ff7a45" /></linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 6" />
        <XAxis dataKey="label" axisLine={false} tickLine={false} dy={8} />
        <YAxis axisLine={false} tickLine={false} tickFormatter={inrShort} width={56} />
        <Tooltip content={<GlassTip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey="income" name="income" fill="url(#bIncome)" radius={[6, 6, 0, 0]} maxBarSize={22} />
        <Bar dataKey="expenses" name="expenses" fill="url(#bExpense)" radius={[6, 6, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data, dataKey = "balance", height = 56, color = "#b8a6ff" }: { data: TrendPoint[]; dataKey?: keyof TrendPoint; height?: number; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#spark-${dataKey})`} dot={false} isAnimationActive animationDuration={1300} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
