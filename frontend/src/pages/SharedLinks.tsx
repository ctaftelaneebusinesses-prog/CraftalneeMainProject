import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, Link2, Lock, Pencil, Plus, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { cn, fmtDate } from "@/lib/format";
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, PageHeader, SearchInput, Select, Skeleton, Textarea } from "@/components/ui/core";
import { Drawer, useConfirm } from "@/components/ui/overlay";

type Person = { id: number; full_name: string; initials: string; designation: string | null; employment_type: string | null; photo_url: string | null };
type Access = "view" | "edit" | "full";
type Sheet = { id: number; title: string; link: string; notes: string | null; owner_name: string | null; mine: boolean;
  access: Access; can_edit: boolean; can_manage: boolean;
  recipients: { id: number; full_name: string; access: Access }[]; created_at: string; updated_at: string };

const ACCESS_OPTIONS: { value: Access; label: string }[] = [
  { value: "view", label: "Can view" }, { value: "edit", label: "Can edit" }, { value: "full", label: "Full access" }];
const ACCESS_LABEL: Record<Access, string> = { view: "Can view", edit: "Can edit", full: "Full access" };
type Data = { sheets: Sheet[]; sees_all: boolean; people: Person[] };

/** Shared links: Drive / OneDrive links to Excel, Docs, Slides, PDFs, folders — anything. Anyone adds one and picks
 *  who can see it; founders and the project manager always see every link. (Stored as "sheets" in the API.) */
export default function SharedLinks() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Sheet | "new" | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["sheets"], queryFn: () => api.get<Data>("/sheets") });

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/sheets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sheets"] }); toast.success("Sheet deleted"); },
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.sheets ?? []).filter((s) => !needle || `${s.title} ${s.notes ?? ""} ${s.owner_name ?? ""}`.toLowerCase().includes(needle));
  }, [data, q]);

  const add = <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Add link</Button>;
  return (
    <>
      <PageHeader eyebrow="Work" title="Shared links" actions={add}
        subtitle={data?.sees_all ? "Every link added by the team — Excel, Docs, Slides, PDFs, folders and more." : "Share links to Excel, Docs, Slides, PDFs, folders — anything — and choose who can see them. Founders and the project manager always can."} />

      {!!data?.sheets.length && <div className="flex justify-end mb-5"><SearchInput value={q} onChange={setQ} placeholder="Search links…" className="w-full sm:w-[260px]" /></div>}

      {isLoading ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        : !data?.sheets.length ? <Card><EmptyState icon={<Link2 />} title="No shared links yet" text="Paste a Drive link to a sheet, doc or anything else and choose who it's shared with." action={add} /></Card>
        : !rows.length ? <Card><EmptyState icon={<Link2 />} title="Nothing matches" text="Try another search." /></Card>
        : (
          <Card className="overflow-hidden"><div className="divide-y divider">
            {rows.map((s) => (
              <div key={s.id} className="group flex items-start gap-4 px-5 py-4">
                <span className="grid place-items-center size-10 shrink-0 rounded-xl bg-brand-500/15 text-brand-300"><Link2 className="size-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={s.link} target="_blank" rel="noopener" className="font-medium hover:underline">{s.title}</a>
                    {s.recipients.length
                      ? <Badge tone="brand"><Users className="size-3" /> {s.recipients.length <= 2 ? s.recipients.map((r) => r.full_name).join(", ") : `${s.recipients.length} people`}</Badge>
                      : <Badge><Lock className="size-3" /> Founders & PM only</Badge>}
                    {!s.mine && !data.sees_all && <Badge tone={s.access === "view" ? "neutral" : "info"}>{ACCESS_LABEL[s.access]}</Badge>}
                  </div>
                  {s.notes && <p className="mt-1 text-[13px] text-fg-2 whitespace-pre-wrap leading-relaxed">{s.notes}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-4">
                    <a href={s.link} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-brand-300 hover:underline"><ExternalLink className="size-3" />Open link</a>
                    <span>{s.mine ? "Added by you" : s.owner_name ? `Added by ${s.owner_name}` : ""} · {fmtDate(s.created_at)}</span>
                  </div>
                </div>
                {s.can_edit && (
                  <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} title={s.can_manage ? "Edit or change who can see it" : "Edit"} onClick={() => setEditing(s)} />
                    {s.can_manage && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete" className="hover:text-bad" onClick={async () => {
                      if (await confirm({ title: `Delete “${s.title}”?`, message: "It disappears for everyone it was shared with. The file itself in Drive is not touched.", danger: true, confirmText: "Delete" })) del.mutate(s.id);
                    }} />}
                  </div>
                )}
              </div>
            ))}
          </div></Card>
        )}

      <SheetDrawer editing={editing} people={data?.people ?? []} onClose={() => setEditing(null)} />
    </>
  );
}

function SheetDrawer({ editing, people, onClose }: { editing: Sheet | "new" | null; people: Person[]; onClose: () => void }) {
  const qc = useQueryClient();
  const sheet = editing && editing !== "new" ? editing : null;
  const [f, setF] = useState({ title: "", link: "", notes: "" });
  const [picked, setPicked] = useState<Map<number, Access>>(new Map());
  const manage = !sheet || sheet.can_manage;
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!editing) return;
    setF({ title: sheet?.title ?? "", link: sheet?.link ?? "", notes: sheet?.notes ?? "" });
    setPicked(new Map(sheet?.recipients.map((r) => [r.id, r.access]) ?? [])); setQ("");
  }, [editing, sheet]);

  const shown = people.filter((e) => !q || `${e.full_name} ${e.designation ?? ""} ${e.employment_type ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const flip = (id: number) => setPicked((s) => { const n = new Map(s); if (n.has(id)) n.delete(id); else n.set(id, "view"); return n; });
  const setAccess = (id: number, a: Access) => setPicked((s) => new Map(s).set(id, a));

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...f, ...(manage && { shares: [...picked].map(([id, access]) => ({ id, access })) }) };
      return sheet ? api.put(`/sheets/${sheet.id}`, payload) : api.post("/sheets", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sheets"] });
      toast.success(sheet ? "Link updated" : picked.size ? `Shared with ${picked.size} ${picked.size === 1 ? "person" : "people"}` : "Link added");
      onClose();
    },
  });

  return (
    <Drawer open={!!editing} onClose={onClose} width={560} title={sheet ? "Edit link" : "Share a link"}
      subtitle={manage ? "Founders and the project manager can always see it. Pick anyone else and what they can do." : "You can change the name, link and notes."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Check />} loading={save.isPending} disabled={!f.title.trim() || !f.link.trim()} onClick={() => save.mutate()}>
          {sheet ? "Save changes" : "Add link"}
        </Button></>}>
      <div className="space-y-5">
        <Field label="Name"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. October leads tracker" autoFocus maxLength={200} /></Field>
        <Field label="Link" hint="Google Sheets, Excel, Docs, Slides, a PDF, a folder — anything"><Input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://drive.google.com/…" /></Field>
        <Field label="Notes" optional><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-[80px]" placeholder="What's in it…" /></Field>
        {manage && <Field label="Share with" optional hint="Can view: open it · Can edit: also change name, link, notes · Full access: also share and delete">
          <div className="rounded-xl border border-white/[0.08] p-3">
            <SearchInput value={q} onChange={setQ} placeholder="Search name, role, type…" className="mb-2" />
            <div className="max-h-60 overflow-y-auto -mx-1">
              {shown.map((e) => (
                <div key={e.id} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5", picked.has(e.id) ? "bg-brand-500/[0.08]" : "hover:bg-white/[0.04]")}>
                  <label className="flex flex-1 min-w-0 items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="size-4 accent-[#7c5cff]" checked={picked.has(e.id)} onChange={() => flip(e.id)} />
                    <Avatar person={e} size={26} />
                    <span className="flex-1 min-w-0 truncate text-[13.5px]">{e.full_name}</span>
                  </label>
                  {picked.has(e.id)
                    ? <Select className="input-sm h-[30px] w-[124px] text-[12.5px]" value={picked.get(e.id)} options={ACCESS_OPTIONS}
                        aria-label={`What ${e.full_name} can do`} onChange={(ev) => setAccess(e.id, ev.target.value as Access)} />
                    : <span className="text-[11.5px] text-fg-4">{e.employment_type}</span>}
                </div>
              ))}
              {!shown.length && <p className="px-2 py-3 text-[13px] text-fg-4">No one found.</p>}
            </div>
            <div className="mt-2 text-[12px] text-fg-4">{picked.size} selected</div>
          </div>
        </Field>}
      </div>
    </Drawer>
  );
}
