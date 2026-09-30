import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Download, FileSpreadsheet, PartyPopper,
  Plane, Plus, Sun, Trash2, Upload, X } from "lucide-react";
import { api, errorMessage, qs, toForm } from "@/lib/api";
import { cn, fmtDate, today } from "@/lib/format";
import { useEmployeeOptions, useMeta } from "@/lib/hooks";
import { can, useSession } from "@/lib/session";
import type { Holiday, Leave, LeaveStatus } from "@/lib/types";
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader, PageSkeleton, Segmented, Textarea, Toggle, type Tone } from "@/components/ui/core";
import { Drawer, FileDrop, Modal, useConfirm } from "@/components/ui/overlay";
import { PersonSelect } from "@/components/PersonSelect";

const STATUS_TONE: Record<LeaveStatus, Tone> = { pending: "warn", approved: "good", rejected: "bad", cancelled: "neutral" };
export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return <Badge tone={STATUS_TONE[status]} dot>{status[0].toUpperCase() + status.slice(1)}</Badge>;
}
const TYPE_COLOR: Record<string, string> = { Casual: "#7c5cff", Sick: "#fb7185", Earned: "#34d399", Unpaid: "#fbbf24", "Work from home": "#60a5fa", Other: "#a78bfa" };

interface CalendarData {
  month: string; leaves: Leave[]; holidays: Holiday[]; types: string[];
  summary: { this_month: number; next_month: number; people_this_month: number; on_leave_today: { id: number; full_name: string; initials: string; photo_url: string | null }[] };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Leaves() {
  const { user } = useSession();
  const admin = can(user, "leaves");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"request" | "admin" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [queue, setQueue] = useState<"pending" | "approved" | "rejected">("pending");

  useEffect(() => { if (params.get("new")) { setDrawer(admin ? "admin" : "request"); params.delete("new"); setParams(params, { replace: true }); } }, [params, setParams, admin]);

  const cal = useQuery({ queryKey: ["leave-cal", month], queryFn: () => api.get<CalendarData>(`/leaves/calendar${qs({ month })}`), placeholderData: keepPreviousData });
  const mine = useQuery({ queryKey: ["leaves-mine"], queryFn: () => api.get<{ leaves: Leave[]; taken_this_year: number; pending: number }>("/leaves/mine"), enabled: !!user?.employee });
  const approvals = useQuery({ queryKey: ["leaves-admin", queue], queryFn: () => api.get<{ leaves: Leave[]; pending: number }>(`/leaves?status=${queue}`), enabled: admin });
  const invalidate = () => ["leave-cal", "leaves-mine", "leaves-admin", "nav-counts", "dashboard", "leaves", "org"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: "approve" | "reject" }) => api.post(`/leaves/${id}/decide`, { decision }),
    onSuccess: (_r, v) => { invalidate(); toast.success(v.decision === "approve" ? "Leave approved" : "Leave rejected"); },
  });
  const cancel = useMutation({ mutationFn: (id: number) => api.post(`/leaves/${id}/cancel`), onSuccess: () => { invalidate(); toast.success("Leave cancelled"); } });
  const delHoliday = useMutation({ mutationFn: (id: number) => api.del(`/holidays/${id}`), onSuccess: () => { invalidate(); toast.success("Holiday removed"); } });

  const [y, m] = month.split("-").map(Number);
  const days = useMemo(() => {
    const first = new Date(y, m - 1, 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7)); // Monday-first grid
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [y, m]);

  if (cal.isLoading || !cal.data) return <PageSkeleton />;
  const data = cal.data;
  const leavesOn = (d: string) => data.leaves.filter((l) => l.start_date <= d && l.end_date >= d);
  const holidayOn = (d: string) => data.holidays.find((h) => h.date === d);
  const shift = (delta: number) => { const d = new Date(y, m - 1 + delta, 1); setMonth(iso(d).slice(0, 7)); setSelected(null); };
  const monthTitle = new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const selLeaves = selected ? leavesOn(selected) : [];
  const selHoliday = selected ? holidayOn(selected) : undefined;

  return (
    <>
      <PageHeader eyebrow="Team" title="Leaves" subtitle="Everyone can see who's away. Requests go to the founder and admins for approval."
        actions={<>
          {admin && <Button icon={<FileSpreadsheet />} onClick={() => setImportOpen(true)}>Import Excel</Button>}
          {admin && <Button icon={<PartyPopper />} onClick={() => setHolidayOpen(true)}>Add holiday</Button>}
          {admin && <Button icon={<CalendarPlus />} onClick={() => setDrawer("admin")}>Add leave</Button>}
          {user?.employee && <Button variant="primary" icon={<Plane />} onClick={() => setDrawer("request")}>Request leave</Button>}
        </>} />

      {/* summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Card glow className="p-5 col-span-2 lg:col-span-1">
          <div className="text-[12.5px] text-fg-3 flex items-center gap-2"><Sun className="size-4 text-flame-400" /> Away today</div>
          {data.summary.on_leave_today.length ? (
            <div className="mt-3 flex items-center">
              <div className="flex -space-x-2">{data.summary.on_leave_today.slice(0, 6).map((p) => <span key={p.id} title={p.full_name} className="ring-2 ring-ink-900 rounded-full"><Avatar person={p} size={34} /></span>)}</div>
              <span className="ml-3 text-[13px] text-fg-2">{data.summary.on_leave_today.length} away</span>
            </div>
          ) : <div className="mt-2 font-display font-bold text-[22px]">Everyone's in 🎉</div>}
        </Card>
        <Stat label={`Leaves in ${new Date(y, m - 1).toLocaleDateString("en-GB", { month: "long" })}`} value={data.summary.this_month} sub={`${data.summary.people_this_month} people`} />
        <Stat label="Next month" value={data.summary.next_month} sub="approved leaves" />
        {user?.employee ? <Stat label="My leave this year" value={mine.data?.taken_this_year ?? 0} sub={`${mine.data?.pending ?? 0} pending request${mine.data?.pending === 1 ? "" : "s"}`} />
          : <Stat label="Holidays this month" value={data.holidays.length} sub="company-wide" />}
      </div>

      {/* approvals */}
      {admin && (
        <Card className="mb-5 overflow-hidden">
          <CardHeader icon={<Check />} title="Approvals" subtitle={approvals.data?.pending ? `${approvals.data.pending} waiting for a decision` : "All caught up"}
            action={<Segmented layoutId="leave-queue" value={queue} onChange={setQueue} options={[{ value: "pending", label: "Pending", count: approvals.data?.pending }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }]} />} />
          <div className="border-t divider divide-y divide-white/[0.05] max-h-[420px] overflow-y-auto">
            <AnimatePresence initial={false}>
              {(approvals.data?.leaves ?? []).map((l) => (
                <motion.div key={l.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 40 }} className="flex flex-wrap items-center gap-4 px-6 py-4">
                  <Avatar person={l.employee} size={40} />
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium">{l.employee.full_name} <span className="text-fg-4 font-normal">· {l.leave_type}{l.half_day ? " (half day)" : ""}</span></div>
                    <div className="text-[12.5px] text-fg-3">{fmtDate(l.start_date)}{l.end_date !== l.start_date && ` → ${fmtDate(l.end_date)}`} · <b className="text-fg-2">{l.days} day{l.days === 1 ? "" : "s"}</b>{l.reason && <> · “{l.reason}”</>}</div>
                    {l.decided_by && <div className="text-[11.5px] text-fg-4 mt-0.5">{l.status} by {l.decided_by}{l.decision_note && ` — ${l.decision_note}`}</div>}
                  </div>
                  {l.status === "pending" ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="danger" icon={<X />} onClick={() => decide.mutate({ id: l.id, decision: "reject" })}>Reject</Button>
                      <Button size="sm" variant="primary" icon={<Check />} onClick={() => decide.mutate({ id: l.id, decision: "approve" })}>Approve</Button>
                    </div>
                  ) : <div className="flex items-center gap-2"><LeaveStatusBadge status={l.status} />
                    <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Cancel leave" onClick={async () => { if (await confirm({ title: "Cancel this leave?", confirmText: "Cancel leave", danger: true })) cancel.mutate(l.id); }} /></div>}
                </motion.div>
              ))}
            </AnimatePresence>
            {!approvals.data?.leaves.length && <div className="px-6 py-8 text-center text-[13px] text-fg-4">Nothing here.</div>}
          </div>
        </Card>
      )}

      {/* calendar */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-[20px] font-bold">{monthTitle}</h2>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => { setMonth(today().slice(0, 7)); setSelected(today()); }}>Today</Button>
              <Button size="sm" iconOnly icon={<ChevronLeft />} onClick={() => shift(-1)} aria-label="Previous month" />
              <Button size="sm" iconOnly icon={<ChevronRight />} onClick={() => shift(1)} aria-label="Next month" />
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-fg-4 mb-1.5">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}
          </div>
          <motion.div key={month} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const key = iso(d);
              const inMonth = d.getMonth() === m - 1;
              const ls = leavesOn(key);
              const hol = holidayOn(key);
              const isToday = key === today();
              const sunday = d.getDay() === 0;
              return (
                <button key={key} onClick={() => setSelected(key)}
                  className={cn("relative min-h-[84px] sm:min-h-[96px] rounded-xl border p-1.5 sm:p-2 text-left transition-all flex flex-col",
                    inMonth ? "bg-white/[0.02]" : "opacity-35", selected === key ? "border-brand-400/70 bg-brand-500/[0.08]" : "border-white/[0.06] hover:border-white/20",
                    hol && "bg-flame-500/[0.08]")}>
                  <span className={cn("text-[12px] font-semibold tnum inline-grid place-items-center size-6 rounded-full", isToday ? "text-on-accent" : sunday ? "text-fg-4" : "text-fg-2")}
                    style={isToday ? { background: "var(--grad)" } : undefined}>{d.getDate()}</span>
                  {hol && <span className="mt-1 text-[10.5px] font-medium text-flame-400 truncate">🎉 {hol.name}</span>}
                  <div className="mt-auto flex flex-wrap gap-0.5">
                    {ls.slice(0, 4).map((l) => (
                      <span key={l.id} className="rounded-full" style={{ boxShadow: `0 0 0 2px ${TYPE_COLOR[l.leave_type] ?? "#7c5cff"}` }} title={`${l.employee.full_name} · ${l.leave_type}`}>
                        <Avatar person={l.employee} size={20} />
                      </span>
                    ))}
                    {ls.length > 4 && <span className="text-[10px] text-fg-3 self-center ml-0.5">+{ls.length - 4}</span>}
                  </div>
                </button>
              );
            })}
          </motion.div>
          <div className="flex flex-wrap gap-3 mt-4 text-[11.5px] text-fg-3">
            {Object.entries(TYPE_COLOR).map(([t, c]) => <span key={t} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: c }} />{t}</span>)}
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-flame-400" />Holiday</span>
          </div>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-24">
          <Card>
            <CardHeader icon={<CalendarDays />} title={selected ? fmtDate(selected, { weekday: "long", day: "numeric", month: "long" }) : "Pick a day"} subtitle={selected ? `${selLeaves.length} away` : "Click a date on the calendar"} />
            <div className="px-5 pb-5 space-y-2">
              {selHoliday && (
                <div className="flex items-center gap-3 rounded-xl border border-flame-500/25 bg-flame-500/[0.08] px-3 py-2.5">
                  <PartyPopper className="size-4 text-flame-400" /><span className="flex-1 text-[13px] font-medium">{selHoliday.name}</span>
                  {admin && <Button size="xs" variant="ghost" iconOnly icon={<Trash2 />} title="Remove holiday" onClick={() => delHoliday.mutate(selHoliday.id)} />}
                </div>
              )}
              {selLeaves.map((l) => (
                <div key={l.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                  <Avatar person={l.employee} size={32} />
                  <div className="flex-1 min-w-0"><div className="text-[13px] font-medium truncate">{l.employee.full_name}</div>
                    <div className="text-[11.5px] text-fg-4">{l.leave_type}{l.half_day && " · half day"} · {fmtDate(l.start_date, { day: "numeric", month: "short" })} → {fmtDate(l.end_date, { day: "numeric", month: "short" })}</div></div>
                  <span className="size-2.5 rounded-full" style={{ background: TYPE_COLOR[l.leave_type] }} />
                </div>
              ))}
              {selected && !selLeaves.length && !selHoliday && <p className="text-[13px] text-fg-4 py-2">No one is away.</p>}
            </div>
          </Card>

          {user?.employee && (
            <Card className="overflow-hidden">
              <CardHeader icon={<Plane />} title="My requests" action={<Button size="xs" icon={<Plus />} onClick={() => setDrawer("request")}>New</Button>} />
              <div className="border-t divider divide-y divide-white/[0.05] max-h-[360px] overflow-y-auto">
                {(mine.data?.leaves ?? []).map((l) => (
                  <div key={l.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium">{l.leave_type} · {l.days}d</div>
                      <div className="text-[11.5px] text-fg-4">{fmtDate(l.start_date)}{l.end_date !== l.start_date && ` → ${fmtDate(l.end_date)}`}</div>
                      {l.decision_note && <div className="text-[11.5px] text-fg-3 mt-0.5">“{l.decision_note}”</div>}
                    </div>
                    <LeaveStatusBadge status={l.status} />
                    {l.status === "pending" && <Button size="xs" variant="ghost" iconOnly icon={<X />} title="Cancel request" onClick={() => cancel.mutate(l.id)} />}
                  </div>
                ))}
                {!mine.data?.leaves.length && <div className="px-5 py-6 text-center text-[13px] text-fg-4">No requests yet.</div>}
              </div>
            </Card>
          )}
        </div>
      </div>

      <LeaveDrawer mode={drawer} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); invalidate(); }} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={invalidate} />
      <HolidayModal open={holidayOpen} onClose={() => setHolidayOpen(false)} onDone={() => { setHolidayOpen(false); invalidate(); }} />
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <Card className="p-5">
      <div className="text-[12.5px] text-fg-3">{label}</div>
      <div className="font-display font-bold text-[26px] mt-1 tnum">{value}</div>
      <div className="text-[12px] text-fg-4">{sub}</div>
    </Card>
  );
}

function LeaveDrawer({ mode, onClose, onDone }: { mode: "request" | "admin" | null; onClose: () => void; onDone: () => void }) {
  const meta = useMeta();
  const { data: people } = useEmployeeOptions();
  const [f, setF] = useState({ leave_type: "Casual", start_date: today(), end_date: today(), half_day: false, reason: "" });
  const [emp, setEmp] = useState<number | null>(null);
  useEffect(() => { if (mode) { setF({ leave_type: "Casual", start_date: today(), end_date: today(), half_day: false, reason: "" }); setEmp(null); } }, [mode]);
  const m = useMutation({
    mutationFn: () => api.post("/leaves", { ...f, employee_id: mode === "admin" ? emp : undefined }),
    onSuccess: () => { toast.success(mode === "admin" ? "Leave added and approved" : "Request sent to the founder & admins"); onDone(); },
  });
  const days = (() => {
    if (f.half_day) return 0.5;
    const s = new Date(f.start_date), e = new Date(f.end_date);
    let n = 0; for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n++;
    return n;
  })();
  return (
    <Drawer open={!!mode} onClose={onClose} title={mode === "admin" ? "Add leave for an employee" : "Request leave"}
      subtitle={mode === "admin" ? "Added leaves are approved immediately and appear on everyone's calendar." : "Your request goes to the founder and admins."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Check />} loading={m.isPending} disabled={mode === "admin" && !emp} onClick={() => m.mutate()}>{mode === "admin" ? "Add leave" : "Send request"}</Button></>}>
      <div className="space-y-5">
        {mode === "admin" && <Field label="Employee"><PersonSelect people={(people?.employees ?? []).filter((p) => p.status === "active")} value={emp} onChange={setEmp} /></Field>}
        <Field label="Leave type">
          <div className="flex flex-wrap gap-2">
            {meta.leave_types.map((t) => (
              <button key={t} type="button" onClick={() => setF({ ...f, leave_type: t })}
                className={cn("inline-flex items-center gap-2 h-9 px-3.5 rounded-xl border text-[13px] transition-all", f.leave_type === t ? "border-white/25 bg-white/10 text-fg" : "border-white/[0.08] text-fg-3 hover:text-fg")}>
                <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />{t}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date })} /></Field>
          <Field label="To"><Input type="date" value={f.end_date} min={f.start_date} disabled={f.half_day} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        </div>
        <Toggle checked={f.half_day} onChange={(v) => setF({ ...f, half_day: v, end_date: v ? f.start_date : f.end_date })} label="Half day" />
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-[13px] text-fg-2">
          <b className="font-display text-[18px] text-fg">{days}</b> working day{days === 1 ? "" : "s"} <span className="text-fg-4">(Sundays & holidays excluded)</span>
        </div>
        <Field label="Reason" optional hint="Only you, the founder and admins can see this."><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="min-h-[90px]" /></Field>
      </div>
    </Drawer>
  );
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ added_leaves: number; added_holidays: number; errors: { row: number; error: string }[] } | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<{ added_leaves: number; added_holidays: number; errors: { row: number; error: string }[] }>("/leaves/import", toForm({}, { file })),
    onSuccess: (r) => { setResult(r); onDone(); toast.success(`Imported ${r.added_leaves} leaves and ${r.added_holidays} holidays`); },
    meta: { silent: true },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const close = () => { setFile(null); setResult(null); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Import leaves from Excel" subtitle="Imported leaves are approved and show on everyone's calendar instantly." width={560}
      footer={<><Button variant="ghost" onClick={close}>{result ? "Done" : "Cancel"}</Button>{!result && <Button variant="primary" icon={<Upload />} disabled={!file} loading={m.isPending} onClick={() => m.mutate()}>Import</Button>}</>}>
      {!result ? (
        <div className="space-y-4">
          <a href="/api/leaves/template" className="flex items-center gap-3 rounded-xl border border-good/25 bg-good/[0.07] px-4 py-3 hover:bg-good/[0.12] transition-colors">
            <FileSpreadsheet className="size-5 text-good" />
            <div className="flex-1"><div className="text-[13.5px] font-medium">Download the Excel template</div><div className="text-[12px] text-fg-3">Employee ID · From · To · Type · Half day · Reason</div></div>
            <Download className="size-4 text-fg-3" />
          </a>
          <FileDrop file={file} onFile={setFile} accept=".xlsx,.csv" label="Drop your .xlsx or .csv here" hint="Leave Employee ID empty (or ALL) and Type = Holiday for company holidays" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-[12px] text-fg-3">Leaves added</div><div className="font-display font-bold text-[26px]">{result.added_leaves}</div></div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-[12px] text-fg-3">Holidays added</div><div className="font-display font-bold text-[26px]">{result.added_holidays}</div></div>
          </div>
          {result.errors.length > 0 && (
            <div className="rounded-xl border border-bad/25 bg-bad/[0.06] p-4 max-h-48 overflow-y-auto">
              <div className="text-[13px] font-medium text-bad mb-2">{result.errors.length} row(s) skipped</div>
              {result.errors.map((e, i) => <div key={i} className="text-[12.5px] text-fg-2">Row {e.row}: {e.error}</div>)}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function HolidayModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState(today());
  const [name, setName] = useState("");
  const m = useMutation({ mutationFn: () => api.post("/holidays", { date: d, name }), onSuccess: () => { toast.success("Holiday added"); setName(""); onDone(); } });
  return (
    <Modal open={open} onClose={onClose} title="Add company holiday" subtitle="Shown on everyone's calendar and excluded from leave day counts."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<PartyPopper />} disabled={!name.trim()} loading={m.isPending} onClick={() => m.mutate()}>Add holiday</Button></>}>
      <div className="space-y-4">
        <Field label="Date"><Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <Field label="Holiday name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Onam" autoFocus /></Field>
      </div>
    </Modal>
  );
}

