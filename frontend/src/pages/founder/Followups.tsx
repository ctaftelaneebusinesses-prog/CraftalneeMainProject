import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, CalendarClock, CalendarX2, Check, Handshake, Mail, MessageCircle, MessageSquareText, Pencil,
  Phone, PhoneCall, Plus, Send, StickyNote, Trash2, Users } from "lucide-react";
import { api, qs } from "@/lib/api";
import { cn, fmtDate, inr, relative } from "@/lib/format";
import { DUE_TONE, dueText } from "@/lib/followups";
import { useDebounced } from "@/lib/hooks";
import type { FollowupCounts, Lead, LeadStatus } from "@/lib/types";
import { AnimatedNumber, Badge, Button, Card, EmptyState, Field, Input, MoneyInput, PageHeader, SearchInput, Segmented,
  Select, Skeleton, Textarea, type Tone } from "@/components/ui/core";
import { Drawer, useConfirm } from "@/components/ui/overlay";

const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "info" },
  contacted: { label: "Contacted", tone: "neutral" },
  in_talks: { label: "In talks", tone: "brand" },
  proposal: { label: "Proposal sent", tone: "warn" },
  won: { label: "Won", tone: "good" },
  lost: { label: "Lost", tone: "bad" },
};
const STATUS_OPTIONS = (Object.keys(LEAD_STATUS) as LeadStatus[]).map((s) => ({ value: s, label: LEAD_STATUS[s].label }));
const SOURCES = ["Referral", "Website", "Social media", "Cold call", "Event", "Existing client", "Other"];
const KIND_ICON: Record<string, typeof Phone> = { Call: Phone, Meeting: Users, Email: Mail, WhatsApp: MessageCircle, Note: StickyNote };
const KINDS = Object.keys(KIND_ICON);

type DueFilter = "" | "overdue" | "today" | "week" | "none";
type ListData = { rows: Lead[]; counts: FollowupCounts };

const EMPTY = { name: "", contact_person: "", phone: "", email: "", source: "", interest: "", est_value: "", status: "new", next_followup: "", notes: "" };

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const QUICK_DATES = [{ label: "Tomorrow", days: 1 }, { label: "3 days", days: 3 }, { label: "1 week", days: 7 }, { label: "2 weeks", days: 14 }, { label: "1 month", days: 30 }];

function DateChips({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {QUICK_DATES.map((q) => {
        const v = addDays(q.days);
        return <button key={q.label} type="button" onClick={() => onChange(v)}
          className={cn("h-7 px-2.5 rounded-lg border text-[12px] transition-colors", value === v ? "border-brand-400 bg-brand-500/15 text-fg" : "border-white/[0.08] text-fg-3 hover:text-fg")}>{q.label}</button>;
      })}
      {allowNone && <button type="button" onClick={() => onChange("")}
        className={cn("h-7 px-2.5 rounded-lg border text-[12px] transition-colors", !value ? "border-brand-400 bg-brand-500/15 text-fg" : "border-white/[0.08] text-fg-3 hover:text-fg")}>No date</button>}
    </div>
  );
}

export default function Followups() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [due, setDue] = useState<DueFilter>((params.get("due") as DueFilter) || "");
  const [status, setStatus] = useState("open");
  const [editing, setEditing] = useState<Lead | "new" | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY);
  const dq = useDebounced(q);

  useEffect(() => { if (params.get("new")) { setEditing("new"); params.delete("new"); setParams(params, { replace: true }); } }, [params, setParams]);
  useEffect(() => {
    if (editing === "new") setForm({ ...EMPTY, next_followup: addDays(1) });
    else if (editing) setForm({ name: editing.name, contact_person: editing.contact_person ?? "", phone: editing.phone ?? "", email: editing.email ?? "",
      source: editing.source ?? "", interest: editing.interest ?? "", est_value: editing.est_value != null ? String(editing.est_value) : "",
      status: editing.status, next_followup: editing.next_followup ?? "", notes: editing.notes ?? "" });
  }, [editing]);

  const { data, isLoading } = useQuery({
    queryKey: ["followups", dq, due, status],
    queryFn: () => api.get<ListData>(`/followups${qs({ q: dq, due, status: due ? "" : status })}`),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => { ["followups", "followup", "dashboard", "nav-counts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const save = useMutation({
    mutationFn: () => editing && editing !== "new" ? api.put<{ lead: Lead }>(`/followups/${editing.id}`, form) : api.post<{ lead: Lead }>("/followups", form),
    onSuccess: (r) => { invalidate(); setEditing(null); toast.success(`${r.lead.name} saved`); },
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/followups/${id}`), onSuccess: () => { invalidate(); setOpenId(null); toast.success("Lead deleted"); } });
  const remove = async (l: Lead) => {
    if (await confirm({ title: `Delete ${l.name}?`, message: "Its follow-up history is deleted too.", danger: true, confirmText: "Delete" })) del.mutate(l.id);
  };
  const f = (k: keyof typeof EMPTY) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value }) });
  const c = data?.counts;
  const pickDue = (d: DueFilter) => setDue((cur) => (cur === d ? "" : d));

  return (
    <>
      <PageHeader eyebrow="Clients" title="Follow-ups" subtitle="Who to call back, when, and what was said last time."
        actions={<Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Add lead</Button>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard active={due === "overdue"} onClick={() => pickDue("overdue")} icon={<AlarmClock className="size-4 text-bad" />} label="Overdue" value={c?.overdue ?? 0} foot="Missed follow-up date" accent={!!c?.overdue && "text-bad"} />
        <StatCard active={due === "today"} onClick={() => pickDue("today")} icon={<CalendarClock className="size-4 text-warn" />} label="Due today" value={c?.today ?? 0} foot="Call or message today" accent={!!c?.today && "text-warn"} />
        <StatCard active={due === "week"} onClick={() => pickDue("week")} icon={<CalendarClock className="size-4 text-brand-300" />} label="Next 7 days" value={c?.week ?? 0} foot={c?.no_date ? `${c.no_date} open without a date` : "Coming up"} />
        <Card glow className="p-5">
          <div className="flex items-center gap-2 text-[12.5px] text-fg-3"><Handshake className="size-4 text-good" />Open pipeline</div>
          <div className="font-display font-bold text-[26px] mt-1"><AnimatedNumber value={c?.pipeline ?? 0} /></div>
          <div className="text-[12px] text-fg-4">{c ? `${c.open} open · ${c.won} won · ${c.lost} lost` : " "}</div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Segmented layoutId="followup-due" value={due} onChange={setDue} options={[
          { value: "", label: "All" }, { value: "overdue", label: "Overdue", count: c?.overdue }, { value: "today", label: "Today", count: c?.today },
          { value: "week", label: "This week", count: c?.week }, { value: "none", label: "No date", count: c?.no_date },
        ]} />
        {!due && <Select className="input-sm h-[38px] w-[170px]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses"
          options={[{ value: "open", label: "Open leads" }, ...STATUS_OPTIONS]} />}
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search name, phone, notes…" className="w-full sm:w-[260px]" />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          : !data?.rows.length ? <EmptyState icon={<PhoneCall />} title={due || dq ? "Nothing matches" : "No follow-ups yet"}
              text={due || dq ? "Try another filter." : "Add clients and leads, set when to call them back, and log what was said."}
              action={!due && !dq ? <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Add lead</Button> : undefined} />
          : (
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>Client</th><th>Status</th><th>Next follow-up</th><th>Last update</th><th className="text-right">Value</th><th /></tr></thead>
              <tbody>{data.rows.map((l) => (
                <tr key={l.id} className="group cursor-pointer" onClick={() => setOpenId(l.id)}>
                  <td>
                    <div className="font-medium">{l.name}</div>
                    <div className="text-[12.5px] text-fg-4 truncate max-w-[260px]">{[l.contact_person, l.interest].filter(Boolean).join(" · ") || l.phone || "—"}</div>
                  </td>
                  <td><Badge tone={LEAD_STATUS[l.status].tone} dot>{LEAD_STATUS[l.status].label}</Badge></td>
                  <td className="whitespace-nowrap">
                    <div className={cn("font-medium text-[13.5px]", DUE_TONE[l.due])}>{dueText(l)}</div>
                    {l.next_followup && <div className="text-[12px] text-fg-4">{fmtDate(l.next_followup)}</div>}
                  </td>
                  <td>{l.last_activity ? (
                    <div className="max-w-[280px]">
                      <div className="text-[13px] text-fg-2 truncate">{l.last_activity.kind}: {l.last_activity.body}</div>
                      <div className="text-[12px] text-fg-4">{relative(l.last_activity.created_at)}</div>
                    </div>) : <span className="text-fg-4 text-[13px]">Not contacted yet</span>}</td>
                  <td className="text-right tnum font-semibold">{l.est_value != null ? inr(l.est_value) : <span className="text-fg-4 font-normal">—</span>}</td>
                  <td onClick={(e) => e.stopPropagation()}><div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {l.phone && <a href={`tel:${l.phone}`} className="btn btn-ghost btn-sm btn-icon" title={`Call ${l.phone}`}><Phone /></a>}
                    <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} title="Edit" onClick={() => setEditing(l)} />
                    <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete" onClick={() => remove(l)} />
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>

      <LeadDrawer id={openId} onClose={() => setOpenId(null)} onEdit={(l) => { setOpenId(null); setEditing(l); }} onDelete={remove} onChanged={invalidate} />

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? `Edit ${editing.name}` : "Add lead"}
        subtitle="A client or prospect to follow up with."
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" icon={<Check />} loading={save.isPending} onClick={() => save.mutate()}>Save lead</Button></>}>
        <div className="space-y-5">
          <Field label="Client / company name"><Input {...f("name")} autoFocus placeholder="e.g. Acme Pvt Ltd" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact person" optional><Input {...f("contact_person")} /></Field>
            <Field label="Phone" optional><Input {...f("phone")} inputMode="tel" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" optional><Input type="email" {...f("email")} /></Field>
            <Field label="Source" optional><Select {...f("source")} placeholder="—" options={SOURCES} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Interested in" optional><Input {...f("interest")} list="lead-interests" placeholder="e.g. Website" />
              <datalist id="lead-interests">{["Website", "Mobile app", "Software", "Training", "Consulting", "Maintenance"].map((s) => <option key={s} value={s} />)}</datalist></Field>
            <Field label="Estimated value" optional><MoneyInput value={form.est_value} onChange={(v) => setForm({ ...form, est_value: v })} placeholder="0" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status"><Select {...f("status")} options={STATUS_OPTIONS} /></Field>
            <Field label="Next follow-up" optional><Input type="date" {...f("next_followup")} /></Field>
          </div>
          {form.status !== "won" && form.status !== "lost" && <DateChips value={form.next_followup} onChange={(v) => setForm({ ...form, next_followup: v })} allowNone />}
          <Field label="Notes" optional><Textarea {...f("notes")} className="min-h-[90px]" placeholder="Requirements, budget, decision maker…" /></Field>
        </div>
      </Drawer>
    </>
  );
}

function StatCard({ active, onClick, icon, label, value, foot, accent }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; value: number; foot: string; accent?: string | false }) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card hover className={cn("p-5 h-full transition-colors", active && "border-brand-400/60")}>
        <div className="flex items-center gap-2 text-[12.5px] text-fg-3">{icon}{label}</div>
        <div className={cn("font-display font-bold text-[26px] mt-1", accent)}><AnimatedNumber value={value} money={false} /></div>
        <div className="text-[12px] text-fg-4">{foot}</div>
      </Card>
    </button>
  );
}

/** One lead: details, log a call / meeting and set the next date in one go, and the history. */
function LeadDrawer({ id, onClose, onEdit, onDelete, onChanged }: { id: number | null; onClose: () => void; onEdit: (l: Lead) => void; onDelete: (l: Lead) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["followup", id], queryFn: () => api.get<{ lead: Lead }>(`/followups/${id}`), enabled: id != null });
  const lead = data?.lead;
  const [kind, setKind] = useState("Call");
  const [text, setText] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => { setKind("Call"); setText(""); setNext(addDays(3)); setStatus(""); }, [id]);

  const closing = status === "won" || status === "lost";
  const apply = (r: { lead: Lead }) => { qc.setQueryData(["followup", id], r); onChanged(); };
  const log = useMutation({
    mutationFn: () => api.post<{ lead: Lead }>(`/followups/${id}/log`, { kind, body: text.trim(), next_followup: closing ? "" : next, status }),
    onSuccess: (r) => { apply(r); setText(""); setStatus(""); setNext(addDays(3)); toast.success("Follow-up logged"); },
  });
  const delLog = useMutation({ mutationFn: (aid: number) => api.del<{ lead: Lead }>(`/followups/${id}/log/${aid}`), onSuccess: apply });
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) log.mutate(); };

  return (
    <Drawer open={id != null} onClose={onClose} width={600} title={lead?.name ?? "Lead"}
      subtitle={lead ? <span className="flex items-center gap-2">{lead.code} <Badge tone={LEAD_STATUS[lead.status].tone} dot>{LEAD_STATUS[lead.status].label}</Badge></span> : undefined}
      footer={lead && <><Button variant="ghost" icon={<Trash2 />} onClick={() => onDelete(lead)}>Delete</Button><div className="flex-1" /><Button icon={<Pencil />} onClick={() => onEdit(lead)}>Edit details</Button></>}>
      {!lead ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13.5px]">
            <Info label="Next follow-up"><span className={cn("font-medium", DUE_TONE[lead.due])}>{dueText(lead)}</span>{lead.next_followup && <span className="text-fg-4"> · {fmtDate(lead.next_followup)}</span>}</Info>
            <Info label="Estimated value">{lead.est_value != null ? inr(lead.est_value) : "—"}</Info>
            <Info label="Contact">{lead.contact_person ?? "—"}</Info>
            <Info label="Phone">{lead.phone ? <a href={`tel:${lead.phone}`} className="text-brand-300 hover:underline">{lead.phone}</a> : "—"}</Info>
            <Info label="Email">{lead.email ? <a href={`mailto:${lead.email}`} className="text-brand-300 hover:underline break-all">{lead.email}</a> : "—"}</Info>
            <Info label="Source">{lead.source ?? "—"}</Info>
            <Info label="Interested in">{lead.interest ?? "—"}</Info>
            <Info label="Added">{fmtDate(lead.created_at)}{lead.created_by_name && <span className="text-fg-4"> · {lead.created_by_name}</span>}</Info>
            {lead.notes && <div className="col-span-2"><div className="text-[12px] text-fg-4 mb-0.5">Notes</div><p className="text-fg-2 whitespace-pre-wrap leading-relaxed">{lead.notes}</p></div>}
          </div>

          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquareText className="size-4 text-brand-300" />
              <h3 className="font-display font-semibold text-[15px]">Log a follow-up</h3>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => {
                  const Icon = KIND_ICON[k];
                  return <button key={k} type="button" onClick={() => setKind(k)}
                    className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12.5px] transition-colors", kind === k ? "border-brand-400 bg-brand-500/15 text-fg" : "border-white/[0.08] text-fg-3 hover:text-fg")}>
                    <Icon className="size-3.5" />{k}</button>;
                })}
              </div>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What was discussed? What's the next step?" className="min-h-[84px]" maxLength={4000}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e); }} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status after this"><Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder={`Keep: ${LEAD_STATUS[lead.status].label}`} options={STATUS_OPTIONS} /></Field>
                <Field label="Next follow-up">{closing
                  ? <div className="input flex items-center gap-2 text-fg-4"><CalendarX2 className="size-4" />Not needed</div>
                  : <Input type="date" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
              </div>
              {!closing && <DateChips value={next} onChange={setNext} allowNone />}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11.5px] text-fg-4">Ctrl + Enter to save</span>
                <Button size="sm" type="submit" variant="primary" icon={<Send />} loading={log.isPending} disabled={!text.trim()}>Save follow-up</Button>
              </div>
            </form>
          </section>

          <section>
            <h3 className="font-display font-semibold text-[15px] mb-3">History</h3>
            {!lead.activities?.length ? <p className="text-[13px] text-fg-4">Nothing logged yet.</p> : (
              <ol className="relative">
                <span className="absolute left-[17px] top-2 bottom-2 w-px bg-white/[0.07]" />
                {lead.activities.map((a) => {
                  const Icon = KIND_ICON[a.kind] ?? StickyNote;
                  return (
                    <li key={a.id} className="group relative flex gap-3.5 pb-4 last:pb-0">
                      <span className="relative z-10 grid place-items-center size-9 shrink-0 rounded-xl border border-white/[0.08] bg-ink-800 text-fg-3"><Icon className="size-4" /></span>
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="flex items-center gap-2 text-[12.5px]">
                          <span className="font-semibold text-fg">{a.kind}</span>
                          <span className="text-fg-4">{a.author_name ?? "Someone"} · {relative(a.created_at)}</span>
                          <button type="button" onClick={() => delLog.mutate(a.id)} className="ml-auto p-1 rounded-md text-fg-4 opacity-0 group-hover:opacity-100 hover:text-bad transition-opacity" aria-label="Delete entry"><Trash2 className="size-3.5" /></button>
                        </div>
                        <p className="mt-0.5 text-[13.5px] text-fg-2 whitespace-pre-wrap leading-relaxed">{a.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[12px] text-fg-4 mb-0.5">{label}</div><div className="text-fg-2">{children}</div></div>;
}
