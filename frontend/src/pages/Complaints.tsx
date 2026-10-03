import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, EyeOff, Lock, MessageSquareReply, MessageSquareWarning, Plus, Send, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { cn, fmtDate, relative } from "@/lib/format";
import type { Complaint, ComplaintStatus } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Segmented, Select, Skeleton, Textarea, Toggle,
  type Tone } from "@/components/ui/core";
import { Drawer } from "@/components/ui/overlay";

type Data = { mine: Complaint[]; all: Complaint[]; can_review: boolean; can_raise: boolean; categories: string[]; open: number };

const STATUS: Record<ComplaintStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "warn" }, in_review: { label: "In review", tone: "info" }, resolved: { label: "Resolved", tone: "good" },
};
const STATUS_OPTIONS = (Object.keys(STATUS) as ComplaintStatus[]).map((s) => ({ value: s, label: STATUS[s].label }));

/** Complaints box: anyone raises one; the founder and admins with the "complaints" area read and resolve them. */
export default function Complaints() {
  const { data, isLoading } = useQuery({ queryKey: ["complaints"], queryFn: () => api.get<Data>("/complaints") });
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [filter, setFilter] = useState<"" | ComplaintStatus>("open");
  const [raising, setRaising] = useState(false);
  const [open, setOpen] = useState<Complaint | null>(null);
  const review = !!data?.can_review;
  const view = review && tab === "all" ? "all" : "mine";
  const rows = (view === "all" ? data?.all ?? [] : data?.mine ?? []).filter((c) => view === "mine" || !filter || c.status === filter);
  const count = (s: ComplaintStatus) => (data?.all ?? []).filter((c) => c.status === s).length;

  return (
    <>
      <PageHeader eyebrow="Work" title="Complaints"
        subtitle={review ? "Complaints raised by the team. Reply and mark them resolved." : "Raise a concern privately. Only the founder and the project manager can read it."}
        actions={data?.can_raise && <Button variant="primary" icon={<Plus />} onClick={() => setRaising(true)}>Raise a complaint</Button>} />

      {review && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {data?.can_raise && <Segmented layoutId="cmp-tab" value={tab} onChange={setTab} options={[{ value: "all", label: "All complaints", count: data.all.length }, { value: "mine", label: "Raised by me", count: data.mine.length }]} />}
          {view === "all" && <Segmented layoutId="cmp-status" value={filter} onChange={setFilter} options={[
            { value: "open", label: "Open", count: count("open") }, { value: "in_review", label: "In review", count: count("in_review") },
            { value: "resolved", label: "Resolved", count: count("resolved") }, { value: "", label: "All" }]} />}
        </div>
      )}

      {isLoading ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        : !rows.length ? (
          <Card><EmptyState icon={<MessageSquareWarning />}
            title={view === "all" ? (filter ? `No ${STATUS[filter].label.toLowerCase()} complaints` : "No complaints yet") : "You haven't raised any complaints"}
            text={view === "all" ? "When someone raises a complaint, it appears here." : "If something is bothering you at work, you can raise it here. You can keep your name hidden."}
            action={view === "mine" && data?.can_raise ? <Button variant="primary" icon={<Plus />} onClick={() => setRaising(true)}>Raise a complaint</Button> : undefined} /></Card>
        ) : (
          <div className="space-y-3">
            {rows.map((c) => (
              <Card key={c.id} hover={view === "all"} className={cn("p-5", view === "all" && "cursor-pointer")} onClick={view === "all" ? () => setOpen(c) : undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] text-fg-4">{c.code}</span>
                  <span className="font-medium">{c.subject}</span>
                  <Badge>{c.category}</Badge>
                  <Badge tone={STATUS[c.status].tone} dot>{STATUS[c.status].label}</Badge>
                  {c.anonymous && <Badge><EyeOff className="size-3" /> Anonymous</Badge>}
                  {c.founder_only && <Badge tone="brand"><Lock className="size-3" /> Founder only</Badge>}
                  <span className="ml-auto text-[12px] text-fg-4">{relative(c.created_at)}</span>
                </div>
                {view === "all" && <Raiser c={c} />}
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

      <RaiseDrawer open={raising} categories={data?.categories ?? []} onClose={() => setRaising(false)} />
      <ReviewDrawer complaint={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Raiser({ c }: { c: Complaint }) {
  return c.raised_by
    ? <div className="mt-2 flex items-center gap-2 text-[12.5px] text-fg-3"><Avatar person={c.raised_by} size={22} />{c.raised_by.full_name}<span className="text-fg-4">· {c.raised_by.employment_type}</span></div>
    : <div className="mt-2 flex items-center gap-2 text-[12.5px] text-fg-4"><EyeOff className="size-3.5" />Name hidden by the person who raised it</div>;
}

function RaiseDrawer({ open, categories, onClose }: { open: boolean; categories: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ subject: "", category: "", message: "", anonymous: false, founder_only: false });
  useEffect(() => { if (open) setF({ subject: "", category: categories[0] ?? "Other", message: "", anonymous: false, founder_only: false }); }, [open, categories]);
  const save = useMutation({
    mutationFn: () => api.post("/complaints", f),
    onSuccess: () => { ["complaints", "nav-counts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Complaint sent. You'll see the reply here."); onClose(); },
  });
  return (
    <Drawer open={open} onClose={onClose} title="Raise a complaint" subtitle="Only the founder and the project manager can read it."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Send />} loading={save.isPending} disabled={!f.subject.trim() || !f.message.trim()} onClick={() => save.mutate()}>Send complaint</Button></>}>
      <div className="space-y-5">
        <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} placeholder="In a few words, what's it about?" autoFocus /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={categories} /></Field>
        <Field label="Details"><Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} className="min-h-[160px]" maxLength={10000} placeholder="What happened, when, and who was involved? What would you like to happen?" /></Field>
        <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <Toggle checked={f.anonymous} onChange={(v) => setF({ ...f, anonymous: v })}
            label={<span><b className="text-fg">Keep my name hidden</b><span className="block text-[12px] text-fg-3">Whoever reads it won't see who raised it. You can still see it and the reply.</span></span>} />
          <Toggle checked={f.founder_only} onChange={(v) => setF({ ...f, founder_only: v })}
            label={<span><b className="text-fg">Only the founder can see this</b><span className="block text-[12px] text-fg-3">For example, if it's about the project manager.</span></span>} />
        </div>
      </div>
    </Drawer>
  );
}

function ReviewDrawer({ complaint, onClose }: { complaint: Complaint | null; onClose: () => void }) {
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
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" icon={<Check />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      {c && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {c.anonymous && <Badge><EyeOff className="size-3" /> Anonymous</Badge>}
            {c.founder_only && <Badge tone="brand"><ShieldCheck className="size-3" /> Founder only</Badge>}
          </div>
          <Raiser c={c} />
          <p className="text-[14px] text-fg-2 whitespace-pre-wrap leading-relaxed">{c.message}</p>
          <Field label="Reply" optional hint="The person who raised it sees this reply."><Textarea value={response} onChange={(e) => setResponse(e.target.value)} className="min-h-[120px]" maxLength={10000} placeholder="What's being done about it…" /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as ComplaintStatus)} options={STATUS_OPTIONS} /></Field>
        </div>
      )}
    </Drawer>
  );
}
