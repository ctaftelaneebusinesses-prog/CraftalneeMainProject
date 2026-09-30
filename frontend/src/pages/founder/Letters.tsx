import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, BriefcaseBusiness, DoorOpen, Pencil, Plus, Send } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDate, inr } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { Letter, LetterKind } from "@/lib/types";
import { Button, Card, EmptyState, FileActions, PageHeader, SearchInput, Segmented, Skeleton } from "@/components/ui/core";
import { EmployeePicker } from "@/components/EmployeePicker";
import { DocIcon } from "@/components/DocRow";
import { DeleteDocButton } from "@/components/DeleteDocButton";

export const LETTER_META: Record<LetterKind, { title: string; single: string; prefix: string; icon: typeof Send }> = {
  offer: { title: "Offer letters", single: "offer letter", prefix: "CL-OFFER", icon: Send },
  joining: { title: "Joining letters", single: "joining letter", prefix: "CL-JOIN", icon: BriefcaseBusiness },
  relieving: { title: "Relieving letters", single: "relieving letter", prefix: "CL-REL", icon: DoorOpen },
};

export default function Letters() {
  const { kind } = useParams() as { kind: LetterKind };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [show, setShow] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState(false);
  const dq = useDebounced(q);
  const meta = LETTER_META[kind];
  const { data, isLoading } = useQuery({
    queryKey: ["letters", kind, show, dq],
    queryFn: () => api.get<{ letters: Letter[] }>(`/letters/${kind}${qs({ show: show === "archived" ? "archived" : "", q: dq })}`),
    placeholderData: keepPreviousData,
    enabled: !!meta,
  });
  const archive = useMutation({
    mutationFn: (id: number) => api.post<{ letter: Letter }>(`/letters/${kind}/${id}/archive`),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["letters", kind] }); toast.success(`${r.letter.number} ${r.letter.archived ? "archived" : "restored"}`); },
  });
  if (!meta) return <Navigate to="/documents" replace />;
  const rows = data?.letters ?? [];

  return (
    <>
      <PageHeader eyebrow="Documents" title={meta.title}
        subtitle={<>Auto-numbered <span className="font-mono text-fg-2">{meta.prefix}-YYYY-NNNN</span> and saved to each employee's profile.</>}
        actions={<Button variant="primary" icon={<Plus />} onClick={() => setPicker(true)}>New {meta.single}</Button>} />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Segmented layoutId={`letters-${kind}`} value={show} onChange={setShow} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search number or employee…" className="w-full sm:w-[300px]" />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : rows.length === 0 ? (
            <EmptyState icon={<meta.icon />} title={q || show === "archived" ? "Nothing found" : `No ${meta.title.toLowerCase()} yet`}
              text={q || show === "archived" ? undefined : "Pick an employee and the letter fills itself in — edit, preview, generate."}
              action={!q && show === "active" && <Button variant="primary" icon={<Plus />} onClick={() => setPicker(true)}>New {meta.single}</Button>} />
          ) : (
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>Document</th><th>Employee</th><th>Designation</th><th>{kind === "relieving" ? "Last working day" : "Joining"}</th><th className="text-right">{kind === "relieving" ? "Tenure from" : "Salary"}</th><th>Issued</th><th /></tr></thead>
              <tbody>{rows.map((l) => (
                <tr key={l.id}>
                  <td><div className="flex items-center gap-3"><DocIcon kind={kind} size={34} /><span className="font-mono text-[12.5px]">{l.number}</span></div></td>
                  <td><Link to={`/employees/${l.employee_id}`} className="font-medium hover:text-brand-300">{l.employee_name}</Link><div className="text-[12px] text-fg-4 font-mono">{l.emp_code}</div></td>
                  <td className="text-fg-2">{l.designation ?? "—"}</td>
                  <td className="text-fg-3 whitespace-nowrap">{fmtDate(l.kind === "relieving" ? l.last_working_day : l.joining_date)}</td>
                  <td className="text-right tnum">{l.kind === "relieving" ? fmtDate(l.joining_date) : inr(l.salary)}</td>
                  <td className="text-fg-3 whitespace-nowrap">{fmtDate(l.letter_date)}</td>
                  <td>
                    <div className="flex justify-end items-center gap-1">
                      <FileActions url={l.file_url} />
                      <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} to={`/letters/${kind}/${l.id}`} title="Edit & regenerate" />
                      <Button size="sm" variant="ghost" iconOnly icon={l.archived ? <ArchiveRestore /> : <Archive />} title={l.archived ? "Restore" : "Archive"} onClick={() => archive.mutate(l.id)} />
                      <DeleteDocButton kind={kind} id={l.id} number={l.number} label={meta.single} />
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>

      <EmployeePicker open={picker} onClose={() => setPicker(false)} title={`New ${meta.single}`} onPick={(id) => navigate(`/letters/${kind}/new?employee=${id}`)} />
    </>
  );
}
