import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Users } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import { useEmployeeOptions } from "@/lib/hooks";
import type { EmployeeBrief } from "@/lib/types";
import { Avatar, Button, EmptyState, Field, SearchInput } from "@/components/ui/core";
import { Modal } from "@/components/ui/overlay";
import { PersonSelect } from "@/components/PersonSelect";
import { EMPLOYMENT_META } from "@/components/EmploymentTypePicker";

interface ReportsResult { message: string }

/** Save a reporting-line change and refresh everything that shows the tree. */
function useReports(onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ managerId, add = [], remove = [] }: { managerId: number; add?: number[]; remove?: number[] }) =>
      api.post<ReportsResult>(`/employees/${managerId}/reports`, { add, remove }),
    onSuccess: (r) => {
      ["employee", "employees", "employee-options", "org", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(r.message);
      onDone();
    },
  });
}

export function useRemoveReport() {
  return useReports(() => undefined);
}

/** IDs of the manager and everyone above them — none of them can be put under the manager. */
function chainAbove(people: EmployeeBrief[], managerId: number) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out = new Set<number>([managerId]);
  let cur = byId.get(managerId)?.manager_id ?? null;
  while (cur && !out.has(cur)) { out.add(cur); cur = byId.get(cur)?.manager_id ?? null; }
  return out;
}

/** From one employee's profile: tick several people (e.g. a batch of interns) to put under them. */
export function AddReportsModal({ manager, open, onClose }: { manager: EmployeeBrief; open: boolean; onClose: () => void }) {
  const { data } = useEmployeeOptions();
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const close = () => { setPicked(new Set()); setQ(""); onClose(); };
  const save = useReports(close);

  const candidates = useMemo(() => {
    const all = data?.employees ?? [];
    const above = chainAbove(all, manager.id);
    return all.filter((p) => p.status === "active" && !above.has(p.id) && p.manager_id !== manager.id);
  }, [data, manager.id]);
  const types = useMemo(() => Array.from(new Set(candidates.map((p) => p.employment_type ?? "Full-time"))), [candidates]);
  const shown = candidates.filter((p) => (type === "all" || (p.employment_type ?? "Full-time") === type)
    && (!q || `${p.full_name} ${p.emp_code} ${p.designation ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const allShown = shown.length > 0 && shown.every((p) => picked.has(p.id));
  const flip = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleShown = () => setPicked((s) => { const n = new Set(s); shown.forEach((p) => (allShown ? n.delete(p.id) : n.add(p.id))); return n; });

  return (
    <Modal open={open} onClose={close} width={600} title={`Add people under ${manager.full_name}`}
      subtitle="They'll report to this person in the team tree, and this person can assign them tasks."
      footer={<>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" icon={<Check />} disabled={!picked.size} loading={save.isPending}
          onClick={() => save.mutate({ managerId: manager.id, add: [...picked] })}>
          {picked.size ? `Add ${picked.size} ${picked.size === 1 ? "person" : "people"}` : "Add people"}
        </Button>
      </>}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {["all", ...types].map((t) => {
          const m = EMPLOYMENT_META[t];
          const n = t === "all" ? candidates.length : candidates.filter((p) => (p.employment_type ?? "Full-time") === t).length;
          return (
            <button key={t} type="button" onClick={() => setType(t)}
              className={cn("inline-flex items-center gap-1.5 h-8 rounded-lg border px-3 text-[12.5px] transition-colors",
                type === t ? "border-brand-400/50 bg-brand-500/10 text-fg" : "border-white/[0.08] text-fg-3 hover:text-fg")}>
              {m && <m.icon className={cn("size-3.5", m.tone)} />}{t === "all" ? "Everyone" : `${t}s`}<span className="text-fg-4">{n}</span>
            </button>
          );
        })}
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="Search name, ID, role…" className="mb-3" />
      {shown.length ? (
        <>
          <div className="flex items-center justify-between mb-1.5 px-1 text-[12.5px] text-fg-4">
            <span>{picked.size} selected</span>
            <button type="button" onClick={toggleShown} className="hover:text-fg">{allShown ? "Unselect shown" : "Select all shown"}</button>
          </div>
          <div className="-mx-2 max-h-[46vh] overflow-y-auto">
            {shown.map((p) => (
              <label key={p.id} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-colors",
                picked.has(p.id) ? "bg-brand-500/[0.08]" : "hover:bg-white/[0.04]")}>
                <input type="checkbox" className="size-4 accent-[#7c5cff]" checked={picked.has(p.id)} onChange={() => flip(p.id)} />
                <Avatar person={p} size={34} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium text-[13.5px]">{p.full_name}</span>
                  <span className="block truncate text-[12px] text-fg-4"><span className="font-mono">{p.emp_code}</span> · {p.employment_type} · {p.designation ?? "—"}</span>
                </span>
                {p.manager_id && <span className="text-[11.5px] text-fg-4 whitespace-nowrap">moves from {data?.employees.find((x) => x.id === p.manager_id)?.full_name ?? "another lead"}</span>}
              </label>
            ))}
          </div>
        </>
      ) : <EmptyState icon={<Users />} title="No one to add" text={type === "all" ? "Everyone active already reports to this person or sits above them." : `No ${type.toLowerCase()}s available.`} />}
    </Modal>
  );
}

/** From the employees list: put everyone selected under one person. */
export function PutUnderModal({ people, open, onClose }: { people: EmployeeBrief[]; open: boolean; onClose: (done: boolean) => void }) {
  const { data } = useEmployeeOptions();
  const [managerId, setManagerId] = useState<number | null>(null);
  const close = (done = false) => { setManagerId(null); onClose(done); };
  const save = useReports(() => close(true));
  const selectedIds = people.map((p) => p.id);
  const leads = (data?.employees ?? []).filter((p) => p.status === "active");
  return (
    <Modal open={open} onClose={() => close()} title={`Put ${people.length} ${people.length === 1 ? "person" : "people"} under…`}
      subtitle={people.map((p) => p.full_name).join(", ")}
      footer={<>
        <Button variant="ghost" onClick={() => close()}>Cancel</Button>
        <Button variant="primary" icon={<Check />} disabled={!managerId} loading={save.isPending}
          onClick={() => managerId && save.mutate({ managerId, add: selectedIds })}>Save</Button>
      </>}>
      <Field label="Reports to">
        <PersonSelect people={leads} value={managerId} onChange={setManagerId} placeholder="Choose their lead" exclude={selectedIds} />
      </Field>
    </Modal>
  );
}
