import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Briefcase, Eye, FileCheck2, GraduationCap } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import { useMeta } from "@/lib/hooks";
import type { EmployeeBrief, Letter, LetterKind } from "@/lib/types";
import { Avatar, Button, Card, Field, Input, MoneyInput, PageHeader, PageSkeleton, Select, Textarea, Toggle } from "@/components/ui/core";
import { EmployeePicker } from "@/components/EmployeePicker";
import { RichTextEditor } from "@/components/RichTextEditor";
import { PdfPreview } from "@/components/PdfPreview";
import { LETTER_META } from "./Letters";

type Draft = Record<string, string | number | null>;

export default function LetterEditor() {
  const { kind, id } = useParams() as { kind: LetterKind; id?: string };
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useMeta();
  const empId = params.get("employee");
  const editing = !!id;
  const lm = LETTER_META[kind];

  const draftQ = useQuery({
    queryKey: ["letter-draft", kind, empId],
    queryFn: () => api.get<{ draft: Draft; number_preview: string; employee: EmployeeBrief }>(`/letters/${kind}/draft?employee_id=${empId}`),
    enabled: !editing && !!empId, staleTime: 0,
  });
  const letterQ = useQuery({
    queryKey: ["letter", kind, id],
    queryFn: () => api.get<{ letter: Letter; employee: EmployeeBrief }>(`/letters/${kind}/${id}`),
    enabled: editing,
  });

  const [d, setD] = useState<Draft | null>(null);
  useEffect(() => {
    if (draftQ.data) setD(draftQ.data.draft);
    if (letterQ.data) setD(letterQ.data.letter as unknown as Draft);
  }, [draftQ.data, letterQ.data]);

  const save = useMutation({
    mutationFn: () => editing ? api.put<{ letter: Letter }>(`/letters/${kind}/${id}`, d!) : api.post<{ letter: Letter }>(`/letters/${kind}`, d!),
    onSuccess: (r) => {
      ["letters", "documents"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["employee", String(r.letter.employee_id)] });
      toast.success(`${r.letter.number} ${editing ? "regenerated" : "generated"}`, {
        action: { label: "Open PDF", onClick: () => window.open(r.letter.file_url, "_blank") },
      });
      navigate(`/employees/${r.letter.employee_id}`);
    },
  });

  if (!editing && !empId) {
    return (
      <>
        <PageHeader back={{ to: `/letters/${kind}`, label: lm.title }} eyebrow="New" title={`Create ${lm.single}`} subtitle="Step 1 — choose the employee or intern." />
        <EmployeePicker open onClose={() => navigate(`/letters/${kind}`)} title={`New ${lm.single}`} onPick={(eid) => navigate(`/letters/${kind}/new?employee=${eid}`, { replace: true })} />
      </>
    );
  }
  if (!d) return <PageSkeleton />;
  const emp = draftQ.data?.employee ?? letterQ.data?.employee;
  const number = editing ? letterQ.data!.letter.number : draftQ.data!.number_preview;
  const v = (k: string) => (d[k] ?? "") as string;
  const set = (k: string, val: string | number | null) => setD((cur) => ({ ...(cur as Draft), [k]: val }));
  const bind = (k: string) => ({ value: v(k), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, e.target.value) });
  const name = kind === "offer" ? "candidate_name" : "employee_name";
  const intern = kind === "offer" && d.letter_type === "internship";
  const fixedTerm = meta.fixed_term_types.includes(v("employment_type"));
  const title = intern ? "internship offer" : lm.single;
  const relieving = kind === "relieving";

  return (
    <>
      <PageHeader back={{ to: emp ? `/employees/${emp.id}` : `/letters/${kind}`, label: emp?.full_name ?? lm.title }}
        eyebrow={editing ? `Editing ${number}` : `New ${title}`} title={editing ? `Edit ${title}` : `Create ${title}`}
        subtitle="Pre-filled from the employee record. The preview on the right is the real PDF — it updates as you type."
        actions={<Button variant="primary" icon={<FileCheck2 />} loading={save.isPending} onClick={() => save.mutate()}>{editing ? "Save & regenerate PDF" : "Generate PDF"}</Button>} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-5">
          <Card className="p-6 space-y-5">
            {emp && (
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <Avatar person={emp} size={40} />
                <div className="flex-1 min-w-0"><div className="font-medium">{emp.full_name}</div><div className="text-[12.5px] text-fg-3">{emp.emp_code} · {emp.employment_type}</div></div>
                <span className="font-mono text-[12px] text-brand-300 bg-brand-500/10 border border-brand-500/25 rounded-lg px-2.5 py-1">{number}</span>
              </div>
            )}
            {kind === "offer" && (
              <div className="grid grid-cols-2 gap-2.5">
                {([["employment", "Employment offer", Briefcase], ["internship", "Internship offer", GraduationCap]] as const).map(([val, label, Icon]) => (
                  <button key={val} type="button" onClick={() => set("letter_type", val)}
                    className={cn("flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all", d.letter_type === val ? "border-brand-400/60 bg-brand-500/[0.08]" : "border-white/[0.08] hover:border-white/20")}>
                    <Icon className={cn("size-5", d.letter_type === val ? "text-brand-300" : "text-fg-4")} />
                    <span className="text-[13.5px] font-medium">{label}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Letter date"><Input type="date" {...bind("letter_date")} /></Field>
              <Field label={intern ? "Intern name" : "Employee name"}><Input {...bind(name)} required /></Field>
              {kind !== "offer" && <Field label="Employee ID"><Input {...bind("emp_code")} className="font-mono" /></Field>}
              <Field label={intern ? "Internship role" : "Designation / roles"} className={kind === "offer" ? "sm:col-span-2" : ""}><Input {...bind("designation")} /></Field>
              <Field label="Department"><Input {...bind("department")} /></Field>
              <Field label="Employment type"><Select {...bind("employment_type")} options={meta.employment_types} /></Field>
              <Field label={intern ? "Start date" : "Joining date"}><Input type="date" {...bind("joining_date")} /></Field>
              {kind === "offer" && (intern || fixedTerm) && <Field label={intern ? "End date" : "Engagement end date"}><Input type="date" {...bind("end_date")} /></Field>}
              {relieving ? (<>
                <Field label="Resignation received" optional><Input type="date" {...bind("resignation_date")} /></Field>
                <Field label="Last working day"><Input type="date" {...bind("last_working_day")} required /></Field>
              </>) : (<>
                <Field label={intern ? "Monthly stipend" : "Monthly salary"}><MoneyInput value={v("salary")} onChange={(x) => set("salary", x)} /></Field>
                <Field label={intern ? "Mentor / reporting to" : "Reporting to"}><Input {...bind("reporting_person")} /></Field>
                <Field label="Work location"><Input {...bind("work_location")} /></Field>
              </>)}
              {kind === "offer" && <Field label="Address" className="sm:col-span-2"><Textarea {...bind("address")} rows={2} className="min-h-[70px]" /></Field>}
            </div>
            {relieving && !editing && (
              <div className="rounded-xl border border-warn/25 bg-warn/[0.06] p-4">
                <Toggle checked={!!d.mark_inactive} onChange={(x) => set("mark_inactive", x ? 1 : 0)}
                  label={<span><b className="text-fg">Mark as inactive after generating</b><span className="block text-[12px] text-fg-3">Removes them from future payrolls and stops their portal login. Their records and documents are kept.</span></span>} />
              </div>
            )}
          </Card>

          {kind === "offer" ? (<>
            <Card className="p-6">
              <div className="font-display font-semibold mb-1">Opening</div>
              <p className="text-[12.5px] text-fg-3 mb-3">The first paragraphs of the letter.</p>
              <RichTextEditor value={v("intro")} onChange={(h) => set("intro", h)} minHeight={140} />
            </Card>
            <Card className="p-6">
              <div className="font-display font-semibold mb-1">Terms & conditions</div>
              <p className="text-[12.5px] text-fg-3 mb-3">Use bold for headings and numbered points for each term. Defaults live in Settings.</p>
              <RichTextEditor value={v("terms")} onChange={(h) => set("terms", h)} minHeight={260} />
            </Card>
          </>) : (
            <Card className="p-6">
              <div className="font-display font-semibold mb-1">Letter body</div>
              <p className="text-[12.5px] text-fg-3 mb-3">{relieving ? "Confirms tenure, relieving and settlement. Edit the default in Settings." : "Format freely — bold, points, alignment and fonts carry into the PDF."}</p>
              <RichTextEditor value={v("body")} onChange={(h) => set("body", h)} minHeight={240} />
            </Card>
          )}
        </div>

        <div className="xl:sticky xl:top-24">
          <div className="flex items-center gap-2 mb-3 text-[12.5px] text-fg-3"><Eye className="size-4" /> Live PDF preview <span className="text-fg-4">· exactly what will be generated</span></div>
          <PdfPreview endpoint={`/letters/${kind}/preview`} payload={{ ...d, number }} />
        </div>
      </div>
    </>
  );
}
