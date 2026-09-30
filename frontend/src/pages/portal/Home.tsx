import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, Check, ListTodo, Plane } from "lucide-react";
import { api } from "@/lib/api";
import { cn, today } from "@/lib/format";
import type { Leave, Task } from "@/lib/types";
import { RoleChips } from "@/pages/founder/Employees";
import { LeaveStatusBadge } from "@/pages/Leaves";
import { motion } from "motion/react";
import { ArrowRight, Building2, CalendarDays, Download, Eye, FileText, IdCard, Receipt, Sparkles, Wallet } from "lucide-react";
import { fmtDate, greeting, inr, monthLabel } from "@/lib/format";
import { AnimatedNumber, Avatar, Button, Card, CardHeader, EmptyState, PageSkeleton, Stagger, StaggerItem } from "@/components/ui/core";
import { DocRow } from "@/components/DocRow";
import { useMe } from "./useMe";

export default function PortalHome() {
  const { data, isLoading } = useMe();
  if (isLoading || !data) return <PageSkeleton />;
  const { employee: e, payslips, documents: d } = data;
  const latest = payslips[0];
  const docs = [
    ...d.offer.map((l) => ({ key: `o${l.id}`, kind: "offer" as const, title: "Offer letter", sub: `${l.number} · ${fmtDate(l.letter_date)}`, url: l.file_url })),
    ...d.joining.map((l) => ({ key: `j${l.id}`, kind: "joining" as const, title: "Joining letter", sub: `${l.number} · ${fmtDate(l.letter_date)}`, url: l.file_url })),
    ...(d.relieving ?? []).map((l) => ({ key: `r${l.id}`, kind: "relieving" as const, title: "Relieving letter", sub: `${l.number} · ${fmtDate(l.letter_date)}`, url: l.file_url })),
    ...d.other.map((x) => ({ key: `d${x.id}`, kind: "doc" as const, title: x.title, sub: fmtDate(x.created_at), url: x.file_url })),
  ];

  return (
    <div className="space-y-6">
      <Card glow className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-70" style={{ background: "radial-gradient(ellipse at 0% 0%, rgba(124,92,255,0.35), transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(255,122,69,0.2), transparent 50%)" }} />
        <div className="relative flex flex-wrap items-center gap-6 p-7 sm:p-9">
          <Avatar person={e} size={96} ring />
          <div className="flex-1 min-w-[220px]">
            <div className="eyebrow flex items-center gap-2"><Sparkles className="size-3.5 text-flame-400" />{greeting()}</div>
            <h1 className="font-display text-[34px] font-bold leading-tight mt-1">Welcome, <span className="text-grad">{e.full_name.split(" ")[0]}</span></h1>
            <div className="mt-2"><RoleChips roles={e.roles} max={5} /></div>
            <p className="text-fg-3 mt-2">{e.department ?? "—"} · {e.employment_type} at {data.company.company_name}</p>
          </div>
        </div>
      </Card>

      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: IdCard, label: "Employee ID", value: <span className="font-mono text-[17px]">{e.emp_code}</span> },
          { icon: Building2, label: "Department", value: e.department ?? "—" },
          { icon: CalendarDays, label: "Joined", value: fmtDate(e.joining_date) },
          { icon: Wallet, label: "Current salary", value: <><AnimatedNumber value={e.monthly_salary ?? 0} /><span className="text-[12px] text-fg-4 font-normal"> /mo</span></> },
        ].map((k) => (
          <StaggerItem key={k.label}>
            <Card className="p-5 h-full">
              <k.icon className="size-[18px] text-brand-300" />
              <div className="text-[12px] text-fg-3 mt-4">{k.label}</div>
              <div className="font-display font-semibold text-[19px] mt-0.5 truncate">{k.value}</div>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <MyTasks />
        <MyLeaves />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-5 items-start">
        <Card className="overflow-hidden">
          <CardHeader icon={<FileText />} title="My documents" action={<Link to="/me/documents" className="text-[12.5px] text-fg-3 hover:text-fg">View all</Link>} />
          <div className="border-t divider divide-y divide-white/[0.05]">
            {docs.length ? docs.slice(0, 6).map((x, i) => <DocRow key={x.key} index={i} kind={x.kind} title={x.title} sub={x.sub} url={x.url} />)
              : <EmptyState icon={<FileText />} title="No documents yet" text="Your offer letter and other documents will appear here." />}
          </div>
        </Card>

        <Card glow className="relative overflow-hidden">
          <div className="absolute -right-16 -top-16 size-52 rounded-full bg-good/15 blur-3xl" />
          <CardHeader icon={<Receipt />} title="Latest payslip" action={<Link to="/me/payslips" className="text-[12.5px] text-fg-3 hover:text-fg">All ({payslips.length})</Link>} />
          {latest ? (
            <div className="relative px-6 pb-6">
              <div className="text-[13px] text-fg-3">{monthLabel(latest.month)}</div>
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="font-display text-[40px] font-extrabold tracking-tight mt-1">
                <AnimatedNumber value={latest.net} />
              </motion.div>
              <div className="text-[12.5px] text-fg-4">Net salary · <span className="font-mono">{latest.number}</span></div>
              <div className="flex gap-2 mt-6">
                <Button icon={<Eye />} href={latest.file_url} className="flex-1">View</Button>
                <Button variant="primary" icon={<Download />} href={`${latest.file_url}&dl=1`} download className="flex-1">Download</Button>
              </div>
              {payslips.length > 1 && (
                <Link to="/me/payslips" className="mt-5 flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-[13px] text-fg-2 hover:border-white/15">
                  Previous: {monthLabel(payslips[1].month)} · <span className="tnum">{inr(payslips[1].net)}</span><ArrowRight className="size-4" />
                </Link>
              )}
            </div>
          ) : <EmptyState icon={<Receipt />} title="No payslips yet" text="Your payslips appear here each month once payroll is processed." />}
        </Card>
      </div>
    </div>
  );
}


function MyTasks() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["tasks", "mine", ""], queryFn: () => api.get<{ tasks: Task[] }>("/tasks?scope=mine") });
  const done = useMutation({
    mutationFn: (id: number) => api.put(`/tasks/${id}`, { status: "done" }),
    onSuccess: () => { ["tasks", "nav-counts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Task completed 🎉 — your lead can see it"); },
  });
  const open = (data?.tasks ?? []).filter((t) => t.status !== "done");
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={<ListTodo />} title="My tasks" subtitle={`${open.length} open`} action={<Link to="/tasks" className="text-[12.5px] text-fg-3 hover:text-fg">Board</Link>} />
      <div className="border-t divider divide-y divide-white/[0.05]">
        {open.slice(0, 5).map((t) => {
          const overdue = t.due_date && t.due_date < today();
          return (
            <div key={t.id} className="flex items-center gap-3 px-6 py-3">
              <button onClick={() => done.mutate(t.id)} title="Mark done" className="grid place-items-center size-6 rounded-full border-2 border-white/20 hover:border-good hover:bg-good/15 text-transparent hover:text-good transition-all"><Check className="size-3.5" /></button>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium truncate">{t.title}</div>
                <div className={cn("text-[11.5px] flex items-center gap-1", overdue ? "text-bad" : "text-fg-4")}>{t.due_date && <><AlarmClock className="size-3" />{overdue ? "Overdue · " : "Due "}{fmtDate(t.due_date, { day: "numeric", month: "short" })} · </>}from {t.created_by_name}</div>
              </div>
              <span className={cn("text-[11px] rounded-md px-1.5 py-0.5", t.status === "in_progress" ? "bg-warn/15 text-warn" : "bg-white/[0.05] text-fg-3")}>{t.status === "in_progress" ? "In progress" : t.priority}</span>
            </div>
          );
        })}
        {!open.length && <EmptyState icon={<ListTodo />} title="All clear" text="No open tasks. New assignments from your lead show up here." />}
      </div>
    </Card>
  );
}

function MyLeaves() {
  const { data } = useQuery({ queryKey: ["leaves-mine"], queryFn: () => api.get<{ leaves: Leave[]; taken_this_year: number; pending: number }>("/leaves/mine") });
  const upcoming = (data?.leaves ?? []).filter((l) => l.end_date >= today() && (l.status === "approved" || l.status === "pending")).slice(0, 3);
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={<CalendarDays />} title="Leaves" subtitle={`${data?.taken_this_year ?? 0} days taken this year`} action={<Button size="xs" variant="primary" icon={<Plane />} to="/leaves?new=1">Request</Button>} />
      <div className="border-t divider divide-y divide-white/[0.05]">
        {upcoming.map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-6 py-3">
            <span className="grid place-items-center size-9 rounded-xl bg-brand-500/12 text-brand-300"><Plane className="size-4" /></span>
            <div className="flex-1"><div className="text-[13.5px] font-medium">{l.leave_type} · {l.days} day{l.days === 1 ? "" : "s"}</div><div className="text-[11.5px] text-fg-4">{fmtDate(l.start_date)}{l.end_date !== l.start_date && ` → ${fmtDate(l.end_date)}`}</div></div>
            <LeaveStatusBadge status={l.status} />
          </div>
        ))}
        {!upcoming.length && <div className="px-6 py-7 text-center text-[13px] text-fg-3">No upcoming leave. <Link to="/leaves" className="text-brand-300 hover:underline">See the team calendar →</Link></div>}
      </div>
    </Card>
  );
}
