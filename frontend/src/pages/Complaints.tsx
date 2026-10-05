import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, EyeOff, MessageSquareReply, MessageSquareWarning, Plus, Send, Trash2, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { cn, fmtDate, relative } from "@/lib/format";
import type { Complaint, ComplaintStatus, EmployeeBrief } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Segmented, Select, Skeleton, Textarea, Toggle,
  type Tone } from "@/components/ui/core";
import { Drawer, useConfirm } from "@/components/ui/overlay";
import { PersonSelect } from "@/components/PersonSelect";

type Data = { mine: Complaint[]; all: Complaint[]; can_review: boolean; can_delete: boolean; can_raise: boolean;
  recipients: EmployeeBrief[]; categories: string[]; open: number; manager_id: number | null };

const STATUS: Record<ComplaintStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "warn" }, in_review: { label: "In review", tone: "info" }, resolved: { label: "Resolved", tone: "good" },
};
const STATUS_OPTIONS = (Object.keys(STATUS) as ComplaintStatus[]).map((s) => ({ value: s, label: STATUS[s].label }));
const sentTo = (c: Complaint) => c.sent_to?.full_name ?? "Founder";

/** Complaints box: anyone raises one and chooses who receives it; that person and the founder resolve it. */
export default function Complaints() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ["complaints"], queryFn: () => api.get<Data>("/complaints") });
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [filter, setFilter] = useState<"" | ComplaintStatus>("open");
  const [raising, setRaising] = useState(false);
  const [open, setOpen] = useState<Complaint | null>(null);
  const review = !!data?.can_review;
  const view = review && tab === "all" ? "all" : "mine";
  const rows = (view === "all" ? data?.all ?? [] : data?.mine ?? []).filter((c) => view === "mine" || !filter || c.status === filter);
  const count = (s: ComplaintStatus) => (data?.all ?? []).filter((c) => c.status === s).length;

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/complaints/${id}`),
    onSuccess: () => { ["complaints", "nav-counts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setOpen(null); toast.success("Complaint deleted"); },
  });
  const remove = async (c: Complaint) => {
    if (await confirm({ title: `Delete ${c.code}?`, message: `“${c.subject}” will be permanently deleted for everyone.`, danger: true, confirmText: "Delete" })) del.mutate(c.id);
  };

  return (
    <>
      <PageHeader eyebrow="Work" title="Complaints"
        subtitle={review ? "Complaints sent to you. Reply and mark them resolved." : "Raise a concern privately with the person you choose."}
        actions={data?.can_raise && <Button variant="primary" icon={<Plus />} onClick={() => setRaising(true)}>Raise a complaint</Button>} />

      {review && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {data?.can_raise && <Segmented layoutId="cmp-tab" value={tab} onChange={setTab} options={[{ value: "all", label: "Received", count: data.all.length }, { value: "mine", label: "Raised by me", count: data.mine.length }]} />}
          {view === "all" && <Segmented layoutId="cmp-status" value={filter} onChange={setFilter} options={[
            { value: "open", label: "Open", count: count("open") }, { value: "in_review", label: "In review", count: count("in_review") },
            { value: "resolved", label: "Resolved", count: count("resolved") }, { value: "", label: "All" }]} />}
        </div>
      )}

      {isLoading ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        : !rows.length ? (
          <Card><EmptyState icon={<MessageSquareWarning />}
            title={view === "all" ? (filter ? `No ${STATUS[filter].label.toLowerCase()} complaints` : "No complaints yet") : "You haven't raised any complaints"}
            text={view === "all" ? "When someone sends you a complaint, it appears here." : "If something is bothering you at work, you can raise it here with the person you choose."}
            action={view === "mine" && data?.can_raise ? <Button variant="primary" icon={<Plus />} onClick={() => setRaising(true)}>Raise a complaint</Button> : undefined} /></Card>
        ) : (
          <div className="space-y-3">
            {rows.map((c) => (
              <Card key={c.id} hover={view === "all"} className={cn("group p-5", view === "all" && "cursor-pointer")} onClick={view === "all" ? () => setOpen(c) : undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] text-fg-4">{c.code}</span>
                  <span className="font-medium">{c.subject}</span>
                  <Badge>{c.category}</Badge>
                  <Badge tone={STATUS[c.status].tone} dot>{STATUS[c.status].label}</Badge>
                  {view === "mine" && c.anonymous && <Badge><EyeOff className="size-3" /> Name hidden from {sentTo(c)}</Badge>}
                  <span className="ml-auto text-[12px] text-fg-4">{relative(c.created_at)}</span>
                  {data?.can_delete && view === "all" && (
                    <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete" className="hover:text-bad opacity-60 group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); remove(c); }} />
                  )}
                </div>
                {view === "all" ? <Raiser c={c} /> : <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-fg-4"><UserRound className="size-3.5" />Sent to {sentTo(c)}</div>}
                <p className={cn("mt-2 text-[13.5px] text-fg-2 whitespace-pre-wrap leading-relaxed", view === "all" && "line-clamp-4")}>{c.message}</p>
                {c.response && (
                  <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                    <div className="flex items-center gap-1.5 text-[12px] text-fg-3"><MessageSquareReply className="size-3.5 text-brand-300" />Reply from {c.responded_by ?? "the team"} · {fmtDate(c.responded_at)}</div>
                    <p className="mt-1 text-[13.5px] text-fg-2 whitespace-pre-wrap leading-relaxed">{c.response}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

      <RaiseDrawer open={raising} categories={data?.categories ?? []} recipients={data?.recipients ?? []} onClose={() => setRaising(false)} />
      <ReviewDrawer complaint={open} canDelete={!!data?.can_delete} onDelete={remove} onClose={() => setOpen(null)} />
    </>
  );
}

/** Who raised it (a founder always sees the name; whoever it was sent to doesn't if it was hidden) and where it went. */
function Raiser({ c }: { c: Complaint }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
      {c.raised_by
        ? <span className="flex items-center gap-2"><Avatar person={c.raised_by} size={22} />{c.raised_by.full_name}<span className="text-fg-4">· {c.raised_by.employment_type}</span></span>
        : <span className="flex items-center gap-2 text-fg-4"><EyeOff className="size-3.5" />Name hidden by the person who raised it</span>}
      {c.raised_by && c.anonymous && <Badge><EyeOff className="size-3" /> Hidden from {sentTo(c)}</Badge>}
      <span className="text-fg-4">→ {sentTo(c)}</span>
    </div>
  );
}

function RaiseDrawer({ open, categories, recipients, onClose }: { open: boolean; categories: string[]; recipients: EmployeeBrief[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ subject: "", category: "", message: "", anonymous: false });
  const [to, setTo] = useState<number | null>(null);
  useEffect(() => { if (open) { setF({ subject: "", category: categories[0] ?? "Other", message: "", anonymous: false }); setTo(null); } }, [open, categories]);
  const recipient = recipients.find((r) => r.id === to) ?? null;
  const toName = recipient?.full_name ?? "Founder";
  const save = useMutation({
    mutationFn: () => api.post("/complaints", { ...f, recipient_id: to }),
    onSuccess: () => { ["complaints", "nav-counts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Complaint sent. You'll see the reply here."); onClose(); },
  });
  return (
    <Drawer open={open} onClose={onClose} title="Raise a complaint" subtitle="Choose who should receive it."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Send />} loading={save.isPending} disabled={!f.subject.trim() || !f.message.trim()} onClick={() => save.mutate()}>Send complaint</Button></>}>
      <div className="space-y-5">
        <Field label="Send to" hint="The founder, the person who handles complaints, or someone above you in the team.">
          <PersonSelect people={recipients} value={to} onChange={setTo} noneLabel="Founder" />
        </Field>
        <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} placeholder="In a few words, what's it about?" autoFocus /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={categories} /></Field>
        <Field label="Details"><Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} className="min-h-[160px]" maxLength={10000} placeholder="What happened, when, and who was involved? What would you like to happen?" /></Field>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <Toggle checked={f.anonymous} onChange={(v) => setF({ ...f, anonymous: v })}
            label={<span><b className="text-fg">Hide my name from {toName}</b><span className="block text-[12px] text-fg-3">{toName} will read it without seeing who raised it.</span></span>} />
        </div>
      </div>
    </Drawer>
  );
}

function ReviewDrawer({ complaint, canDelete, onDelete, onClose }: { complaint: Complaint | null; canDelete: boolean; onDelete: (c: Complaint) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState<ComplaintStatus>("open");
  useEffect(() => { if (complaint) { setResponse(complaint.response ?? ""); setStatus(complaint.status === "open" ? "in_review" : complaint.status); } }, [complaint]);
  const save = useMutation({
    mutationFn: () => api.put(`/complaints/${complaint!.id}`, { response, status }),
    onSuccess: () => { ["complaints", "nav-counts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(status === "resolved" ? "Marked resolved" : "Saved"); onClose(); },
  });
  const c = complaint;
  return (
    <Drawer open={!!c} onClose={onClose} width={600} title={c ? c.subject : ""} subtitle={c ? `${c.code} · ${c.category} · raised ${fmtDate(c.created_at)}` : undefined}
      footer={<>{canDelete && c && <Button variant="ghost" icon={<Trash2 />} className="hover:text-bad" onClick={() => onDelete(c)}>Delete</Button>}
        <div className="flex-1" /><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" icon={<Check />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      {c && (
        <div className="space-y-5">
          <Raiser c={c} />
          <p className="text-[14px] text-fg-2 whitespace-pre-wrap leading-relaxed">{c.message}</p>
          <Field label="Reply" optional hint="The person who raised it sees this reply."><Textarea value={response} onChange={(e) => setResponse(e.target.value)} className="min-h-[120px]" maxLength={10000} placeholder="What's being done about it…" /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as ComplaintStatus)} options={STATUS_OPTIONS} /></Field>
        </div>
      )}
    </Drawer>
  );
}
