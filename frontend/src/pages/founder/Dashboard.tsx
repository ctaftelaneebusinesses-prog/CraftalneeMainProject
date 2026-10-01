import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { CalendarDays, CheckCircle2, GraduationCap, Layers, ListTodo, PhoneCall, Plane } from "lucide-react";
import { Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BriefcaseBusiness, FileText, Handshake,
  Plus, Send, Settings2, Sparkles, TrendingDown, TrendingUp, UserPlus, Users, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { cn, greeting, inr, monthLabel, relative } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import type { AuditEntry, CategoryAmount, EmployeeBrief, FollowupCounts, Lead, Leave, Task, Totals, TrendPoint } from "@/lib/types";
import { DUE_TONE, dueText } from "@/lib/followups";
import { EMPLOYMENT_META } from "@/components/EmploymentTypePicker";
import { AnimatedNumber, Avatar, Button, Card, CardHeader, EmptyState, PageSkeleton, Stagger, StaggerItem } from "@/components/ui/core";
import { CATEGORY_COLORS, Donut, Sparkline, TrendChart } from "@/components/charts";

interface DashboardData {
  // Sections outside the viewer's granted areas come back null / empty.
  people: { total: number; active: number; monthly_payroll: number | null; salaries: number | null; stipends: number | null;
    employees_total: number; employees_active: number; interns_total: number; interns_active: number };
  totals: Totals | null;
  this_month: (Totals & { label: string }) | null;
  trend: TrendPoint[];
  categories: CategoryAmount[];
  departments: { name: string; count: number }[];
  recent_employees: EmployeeBrief[];
  activity: AuditEntry[];
  draft_months: string[];
  by_type: { type: string; count: number }[];
  by_role: { role: string; count: number }[];
  multi_role: number;
  on_leave_today: Leave[];
  pending_leaves: number;
  tasks: { todo: number; in_progress: number; done: number };
  recent_done: Task[];
  followups: (FollowupCounts & { due: Lead[] }) | null;
}

const ACTIVITY_ICON: Record<string, typeof Activity> = { employee: Users, document: FileText, payroll: Wallet, finance: TrendingUp, settings: Settings2, leave: CalendarDays, task: ListTodo };

export default function Dashboard() {
  const { user, session } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardData>("/dashboard") });
  if (isLoading || !data) return <PageSkeleton />;
  const { totals, people, this_month: tm } = data;
  const finance = can(user, "finance");
  const monthTotal = data.categories.reduce((s, c) => s + c.amount, 0);
  const maxDept = Math.max(1, ...data.departments.map((d) => d.count));

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2 flex items-center gap-2"><Sparkles className="size-3.5 text-flame-400" /> {session?.company?.company_name} overview</div>
          <h1 className="font-display text-[32px] leading-tight font-bold">{greeting()}, <span className="text-grad">{user?.name.split(" ")[0]}</span></h1>
          <p className="text-fg-3 mt-1.5">Here's how your company is doing today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {finance && <Button to="/finance/expenses?new=1" icon={<TrendingDown />}>Expense</Button>}
          {finance && <Button to="/finance/income?new=1" icon={<TrendingUp />}>Income</Button>}
          {can(user, "employees") && <Button to="/employees/new" variant="primary" icon={<UserPlus />}>Add employee</Button>}
        </div>
      </div>

      {data.draft_months.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-warn/25 bg-gradient-to-r from-warn/[0.1] to-transparent px-5 py-4">
          <span className="grid place-items-center size-9 rounded-xl bg-warn/15 text-warn"><AlertTriangle className="size-4" /></span>
          <div className="flex-1 min-w-[200px]">
            <div className="font-medium">Payroll for {data.draft_months.map((m) => monthLabel(m)).join(", ")} is still in draft</div>
            <div className="text-[13px] text-fg-3">Finalise it so salaries are posted to expenses and payslips are generated.</div>
          </div>
          <Button size="sm" to={`/payroll/${data.draft_months[0]}`}>Review payroll <ArrowRight /></Button>
        </motion.div>
      )}

      {data.followups && data.followups.due.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-brand-400/25 bg-gradient-to-r from-brand-500/[0.1] to-transparent px-5 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid place-items-center size-9 rounded-xl bg-brand-500/15 text-brand-300"><PhoneCall className="size-4" /></span>
            <div className="flex-1 min-w-[200px]">
              <div className="font-medium">
                {[data.followups.overdue && `${data.followups.overdue} overdue`, data.followups.today && `${data.followups.today} due today`].filter(Boolean).join(" · ")} client follow-up{data.followups.overdue + data.followups.today === 1 ? "" : "s"}
              </div>
              <div className="text-[13px] text-fg-3">Call them back and log what was said.</div>
            </div>
            <Button size="sm" to={`/followups?due=${data.followups.overdue ? "overdue" : "today"}`}>Open follow-ups <ArrowRight /></Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 pl-[52px]">
            {data.followups.due.map((l) => (
              <Link key={l.id} to="/followups" className="inline-flex items-center gap-2 h-7 rounded-lg border border-white/[0.08] px-2.5 text-[12.5px] hover:border-white/20 transition-colors">
                <span className="font-medium text-fg">{l.name}</span><span className={DUE_TONE[l.due]}>{dueText(l)}</span>
              </Link>
            ))}
          </div>
        </motion.div>
      )}

      {/* KPI grid */}
      <Stagger className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {totals && <StaggerItem className="md:col-span-2 xl:col-span-2 xl:row-span-2">
          <Card glow className="relative h-full overflow-hidden p-6 flex flex-col">
            <div className="absolute -right-24 -top-24 size-72 rounded-full bg-brand-500/25 blur-3xl" />
            <div className="absolute -left-10 bottom-0 size-56 rounded-full bg-flame-500/10 blur-3xl" />
            <div className="relative flex items-center justify-between">
              <span className="eyebrow">Current balance</span>
              <span className={cn("badge", totals.balance >= 0 ? "badge-good" : "badge-bad")}><span className="dot" />{totals.balance >= 0 ? "Positive" : "Negative"}</span>
            </div>
            <div className="relative mt-4 font-display text-[46px] leading-none font-extrabold tracking-tight">
              <AnimatedNumber value={totals.balance} className={totals.balance < 0 ? "text-bad" : ""} />
            </div>
            <div className="relative mt-2 text-[13px] text-fg-3">Received income − all expenses (payroll included)</div>
            <div className="relative mt-auto pt-6 -mx-2"><Sparkline data={data.trend} height={90} /></div>
            <div className="relative grid grid-cols-2 gap-3 pt-4 border-t divider">
              <div>
                <div className="flex items-center gap-1.5 text-[12px] text-fg-3"><ArrowUpRight className="size-3.5 text-good" /> Income</div>
                <div className="font-semibold tnum mt-0.5"><AnimatedNumber value={totals.income} /></div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[12px] text-fg-3"><ArrowDownRight className="size-3.5 text-bad" /> Expenses</div>
                <div className="font-semibold tnum mt-0.5"><AnimatedNumber value={totals.expenses} /></div>
              </div>
            </div>
          </Card>
        </StaggerItem>}
        <StaggerItem><Kpi icon={<Users />} label="Employees" value={people.employees_active} money={false} foot={`Active · ${people.employees_total - people.employees_active} inactive`} tint="brand" to="/employees" /></StaggerItem>
        <StaggerItem><Kpi icon={<GraduationCap />} label="Interns & trainees" value={people.interns_active} money={false} foot={`Active · ${people.interns_total - people.interns_active} inactive`} tint="good" to="/employees" /></StaggerItem>
        {people.monthly_payroll !== null && <StaggerItem><Kpi icon={<Wallet />} label="Monthly payroll" value={people.monthly_payroll}
          foot={people.salaries && people.stipends ? `${inr(people.salaries)} salaries · ${inr(people.stipends)} stipends` : people.stipends ? "Intern & trainee stipends" : "Active salaries"}
          tint="flame" to={can(user, "payroll") ? "/payroll" : "/employees"} /></StaggerItem>}
        {totals && <StaggerItem><Kpi icon={<TrendingUp />} label="Total income" value={totals.income} foot={totals.pending_income ? `${inr(totals.pending_income)} pending` : "Received to date"} tint="info" to="/finance/income" /></StaggerItem>}
      </Stagger>

      {/* team insights */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader icon={<Layers />} title="Team composition" subtitle={`${data.multi_role} ${data.multi_role === 1 ? "person holds" : "people hold"} multiple roles`} action={can(user, "employees") && <Link to="/employees" className="text-[12.5px] text-fg-3 hover:text-fg">Details</Link>} />
          <div className="px-6 pb-6 space-y-3">
            {data.by_type.map((t, i) => {
              const m = EMPLOYMENT_META[t.type] ?? EMPLOYMENT_META["Full-time"];
              return (
                <div key={t.type} className="flex items-center gap-3">
                  <m.icon className={cn("size-4 shrink-0", m.tone)} />
                  <span className="w-24 text-[13px] text-fg-2">{t.type}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/[0.05] overflow-hidden"><motion.div className="h-full rounded-full" style={{ background: "var(--grad)" }} initial={{ width: 0 }} animate={{ width: `${(t.count / Math.max(1, people.active)) * 100}%` }} transition={{ delay: 0.1 + i * 0.06, duration: 0.8 }} /></div>
                  <span className="w-6 text-right tnum text-[13px] font-semibold">{t.count}</span>
                </div>
              );
            })}
            {!data.by_type.length && <p className="text-[13px] text-fg-4">No active employees yet.</p>}
            {data.by_role.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-3 border-t divider">
                {data.by_role.map((r) => <span key={r.role} className="inline-flex items-center gap-1.5 h-6 rounded-md border border-white/[0.08] px-2 text-[11.5px] text-fg-2">{r.role}<span className="text-fg-4">{r.count}</span></span>)}
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<ListTodo />} title="Tasks" subtitle={`${data.tasks.todo + data.tasks.in_progress} open across the team`} action={<Link to="/tasks" className="text-[12.5px] text-fg-3 hover:text-fg">Board</Link>} />
          <div className="px-6 pb-6">
            <div className="grid grid-cols-3 gap-2">
              {([["To do", data.tasks.todo, "#9d84ff"], ["In progress", data.tasks.in_progress, "#fbbf24"], ["Done", data.tasks.done, "#34d399"]] as const).map(([l, n, c]) => (
                <div key={l} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="font-display font-bold text-[22px] tnum"><AnimatedNumber value={n} money={false} /></div>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-fg-3"><span className="size-1.5 rounded-full" style={{ background: c }} />{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2.5">
              {data.recent_done.slice(0, 4).map((t) => (
                <div key={t.id} className="flex items-center gap-2.5 text-[13px]">
                  <CheckCircle2 className="size-4 text-good shrink-0" />
                  <span className="flex-1 truncate">{t.title}</span>
                  <Avatar person={t.assignee} size={22} />
                </div>
              ))}
              {!data.recent_done.length && <p className="text-[12.5px] text-fg-4">Completed tasks will appear here.</p>}
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Plane />} title="Away today" subtitle={data.pending_leaves ? `${data.pending_leaves} leave request${data.pending_leaves === 1 ? "" : "s"} awaiting approval` : "No pending requests"}
            action={<Link to="/leaves" className="text-[12.5px] text-fg-3 hover:text-fg">Calendar</Link>} />
          <div className="px-6 pb-6 space-y-2.5">
            {data.on_leave_today.map((l) => (
              <div key={l.id} className="flex items-center gap-3">
                <Avatar person={l.employee} size={32} />
                <div className="flex-1 min-w-0"><div className="text-[13px] font-medium truncate">{l.employee.full_name}</div><div className="text-[11.5px] text-fg-4">{l.leave_type} · back after {new Date(l.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div></div>
              </div>
            ))}
            {!data.on_leave_today.length && <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-[13px] text-fg-3">Everyone's in today 🎉</div>}
            {data.pending_leaves > 0 && <Button size="sm" variant="primary" className="w-full mt-2" to="/leaves">Review {data.pending_leaves} request{data.pending_leaves === 1 ? "" : "s"}</Button>}
          </div>
        </Card>
      </div>

      {/* charts */}
      {finance && tm && <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader icon={<Activity />} title="Cash flow" subtitle="Income vs expenses · last 6 months"
            action={<div className="flex items-center gap-4 text-[12px] text-fg-3"><Legend color="#9d84ff" label="Income" /><Legend color="#ff9466" label="Expenses" /></div>} />
          <div className="px-3 pb-4"><TrendChart data={data.trend} height={280} /></div>
        </Card>
        <Card>
          <CardHeader icon={<TrendingDown />} title="Spending" subtitle={tm.label} action={<Link to="/finance" className="text-[12.5px] text-fg-3 hover:text-fg">Details</Link>} />
          {data.categories.length ? (
            <div className="px-6 pb-6">
              <Donut data={data.categories} height={190} center={<div><div className="text-[11px] text-fg-4 uppercase tracking-wider">Spent</div><div className="font-display font-bold text-[20px] tnum">{inr(monthTotal)}</div></div>} />
              <div className="mt-5 space-y-2.5">
                {data.categories.slice(0, 5).map((c, i) => (
                  <div key={c.category} className="flex items-center gap-3 text-[13px]">
                    <span className="size-2.5 rounded-full" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                    <span className="text-fg-2 flex-1 truncate">{c.category}</span>
                    <span className="tnum text-fg">{inr(c.amount)}</span>
                    <span className="w-10 text-right text-fg-4 tnum text-[12px]">{Math.round((c.amount / monthTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyState icon={<TrendingDown />} title="No spending yet" text="Expenses recorded this month will appear here." />}
        </Card>
      </div>}

      {/* activity + team */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {can(user, "settings") && <Card className="xl:col-span-2">
          <CardHeader icon={<Activity />} title="Recent activity" subtitle="Latest actions across the company" action={<Link to="/settings/audit" className="text-[12.5px] text-fg-3 hover:text-fg">Audit log</Link>} />
          {data.activity.length ? (
            <ol className="relative px-6 pb-5">
              <span className="absolute left-[41px] top-2 bottom-6 w-px bg-gradient-to-b from-white/10 via-white/5 to-transparent" />
              {data.activity.map((a, i) => {
                const Icon = ACTIVITY_ICON[a.category ?? ""] ?? Activity;
                return (
                  <motion.li key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
                    className="relative flex items-start gap-4 py-2.5">
                    <span className="relative z-10 grid place-items-center size-9 rounded-xl border border-white/[0.08] bg-ink-800 text-fg-3 [&>svg]:size-4"><Icon /></span>
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="text-[13.5px]"><span className="font-semibold text-fg">{a.user_name}</span> <span className="text-fg-2">{a.action}</span></div>
                      {a.details && <div className="text-[12.5px] text-fg-4 truncate">{a.details}</div>}
                    </div>
                    <span className="pt-1 text-[12px] text-fg-4 whitespace-nowrap">{relative(a.created_at)}</span>
                  </motion.li>
                );
              })}
            </ol>
          ) : <EmptyState icon={<Activity />} title="No activity yet" text="Adding employees, generating letters and payslips will show up here." />}
        </Card>}

        <div className="space-y-4">
          <Card>
            <CardHeader icon={<Sparkles />} title="Quick actions" />
            <div className="grid grid-cols-2 gap-2 px-5 pb-5">
              {([
                { to: "/payroll", icon: Wallet, label: "Run payroll", area: "payroll" },
                { to: "/letters/offer/new", icon: Send, label: "Offer letter", area: "documents" },
                { to: "/letters/joining/new", icon: BriefcaseBusiness, label: "Joining letter", area: "documents" },
                { to: "/mous/new", icon: Handshake, label: "New MOU", area: "documents" },
                { to: "/leaves?new=1", icon: CalendarDays, label: "Add leave", area: "leaves" },
                { to: "/tasks?new=1", icon: ListTodo, label: "Assign task", area: "team" },
              ] as const).filter((q) => can(user, q.area)).slice(0, 4).map((q) => (
                <Link key={q.to} to={q.to} className="group flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 hover:border-brand-400/40 hover:bg-brand-500/[0.07] transition-all">
                  <q.icon className="size-[18px] text-fg-3 group-hover:text-brand-300 transition-colors" />
                  <span className="text-[13px] font-medium">{q.label}</span>
                </Link>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader icon={<Users />} title="Team" subtitle={`${people.active} active across ${data.departments.length} departments`} action={<Link to="/employees" className="text-[12.5px] text-fg-3 hover:text-fg">All</Link>} />
            <div className="px-6 pb-5 space-y-3">
              {data.departments.slice(0, 4).map((d, i) => (
                <div key={d.name}>
                  <div className="flex justify-between text-[12.5px] mb-1.5"><span className="text-fg-2">{d.name}</span><span className="text-fg-4 tnum">{d.count}</span></div>
                  <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: "var(--grad)" }} initial={{ width: 0 }} animate={{ width: `${(d.count / maxDept) * 100}%` }} transition={{ delay: 0.2 + i * 0.08, duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
                  </div>
                </div>
              ))}
              {data.recent_employees.length > 0 && (
                <div className="flex items-center pt-2">
                  <div className="flex -space-x-2.5">
                    {data.recent_employees.map((e) => <Link key={e.id} to={`/employees/${e.id}`} title={e.full_name} className="ring-2 ring-ink-850 rounded-full hover:-translate-y-0.5 transition-transform"><Avatar person={e} size={32} /></Link>)}
                  </div>
                  <Link to="/employees/new" className="ml-3 grid place-items-center size-8 rounded-full border border-dashed border-white/20 text-fg-3 hover:text-fg hover:border-white/40"><Plus className="size-4" /></Link>
                </div>
              )}
              {data.departments.length === 0 && <p className="text-[13px] text-fg-3">No employees yet.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />{label}</span>;
}

const TINTS = {
  brand: "from-brand-500/25 text-brand-300",
  good: "from-good/20 text-good",
  flame: "from-flame-500/25 text-flame-400",
  info: "from-info/20 text-info",
};

function Kpi({ icon, label, value, foot, money = true, tint, to }: { icon: React.ReactNode; label: string; value: number; foot: string; money?: boolean; tint: keyof typeof TINTS; to: string }) {
  return (
    <Link to={to} className="block h-full">
      <Card hover className="group relative h-full overflow-hidden p-5">
        <div className={cn("absolute -right-8 -top-8 size-28 rounded-full bg-gradient-to-br to-transparent blur-2xl opacity-60 group-hover:opacity-100 transition-opacity", TINTS[tint])} />
        <div className="relative flex items-center justify-between">
          <span className={cn("grid place-items-center size-10 rounded-xl bg-gradient-to-br to-white/[0.02] border border-white/[0.08] [&>svg]:size-[18px]", TINTS[tint])}>{icon}</span>
          <ArrowUpRight className="size-4 text-fg-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </div>
        <div className="relative mt-5 text-[12.5px] text-fg-3">{label}</div>
        <div className="relative mt-1 font-display text-[26px] font-bold tracking-tight"><AnimatedNumber value={value} money={money} /></div>
        <div className="relative mt-1 text-[12px] text-fg-4">{foot}</div>
      </Card>
    </Link>
  );
}
