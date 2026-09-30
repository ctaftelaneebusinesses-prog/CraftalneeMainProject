import { useEffect, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Check, Eye, FileText, PenLine } from "lucide-react";
import { api } from "@/lib/api";
import { useFormState } from "@/lib/hooks";
import type { Mou } from "@/lib/types";
import { Button, Card, Field, Input, PageHeader, PageSkeleton, Textarea } from "@/components/ui/core";
import { RichTextEditor } from "@/components/RichTextEditor";
import { PdfPreview } from "@/components/PdfPreview";

const EMPTY = { party_name: "", contact_person: "", address: "", start_date: "", end_date: "", purpose: "", scope: "",
  payment_terms: "", responsibilities: "", terms: "", signatory: "", signatory_designation: "" };
type Values = typeof EMPTY;
const RICH: { key: keyof Values; label: string; hint: string; min: number }[] = [
  { key: "purpose", label: "1 · Purpose", hint: "Why the parties are working together.", min: 90 },
  { key: "scope", label: "2 · Scope of work", hint: "What will be delivered.", min: 110 },
  { key: "payment_terms", label: "Financial terms", hint: "Fees, schedule and invoicing.", min: 90 },
  { key: "responsibilities", label: "Roles & responsibilities", hint: "Use bullet points for each party.", min: 130 },
  { key: "terms", label: "Terms & conditions", hint: "Pre-filled with your default clauses — edit freely.", min: 200 },
];

export default function MouEditor() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { values, setValues, bind, set } = useFormState<Values>(EMPTY);
  const draft = useQuery({ queryKey: ["mou-new"], queryFn: () => api.get<{ number_preview: string; defaults: Partial<Values> }>("/mous/new"), enabled: !editing, staleTime: 0 });
  const existing = useQuery({ queryKey: ["mou", id], queryFn: () => api.get<{ mou: Mou }>(`/mous/${id}`), enabled: editing });

  useEffect(() => {
    if (existing.data) {
      const m = existing.data.mou as unknown as Record<string, string | null>;
      setValues(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, m[k] ?? ""])) as Values);
    } else if (!editing && draft.data) {
      const d = draft.data.defaults;
      setValues((v) => ({ ...v, signatory: v.signatory || d.signatory || "", signatory_designation: v.signatory_designation || d.signatory_designation || "", terms: v.terms || d.terms || "" }));
    }
  }, [existing.data, draft.data, editing, setValues]);

  const save = useMutation({
    mutationFn: () => editing ? api.put<{ mou: Mou }>(`/mous/${id}`, values) : api.post<{ mou: Mou }>("/mous", values),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["mous"] });
      qc.setQueryData(["mou", String(r.mou.id)], r);
      toast.success(`${r.mou.number} ${editing ? "updated" : "created"}`, { action: { label: "Open PDF", onClick: () => window.open(r.mou.file_url, "_blank") } });
      navigate(`/mous/${r.mou.id}`);
    },
  });
  if (editing && existing.isLoading) return <PageSkeleton />;
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const number = editing ? existing.data?.mou.number : draft.data?.number_preview;

  return (
    <form onSubmit={submit}>
      <PageHeader back={{ to: editing ? `/mous/${id}` : "/mous", label: editing ? number ?? "MOU" : "MOU" }}
        eyebrow={number ? <span className="font-mono normal-case tracking-normal">{number}</span> : "MOU"}
        title={editing ? "Edit MOU" : "Create MOU"} subtitle="The preview on the right is the real, signature-ready PDF."
        actions={<Button variant="primary" type="submit" icon={<Check />} loading={save.isPending}>{editing ? "Save & regenerate PDF" : "Create MOU"}</Button>} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-5">
          <Card className="p-6">
            <div className="flex items-center gap-2.5 mb-5"><span className="grid place-items-center size-8 rounded-lg bg-flame-500/15 text-flame-400"><Building2 className="size-4" /></span><h3 className="font-display font-semibold">Second party</h3></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Party / organisation"><Input {...bind("party_name")} required placeholder="e.g. Sree Narayana College" /></Field>
              <Field label="Represented by"><Input {...bind("contact_person")} placeholder="e.g. Dr. Meera Nair, Principal" /></Field>
              <Field label="Address" className="sm:col-span-2"><Textarea {...bind("address")} rows={2} className="min-h-[70px]" /></Field>
              <Field label="Effective from"><Input type="date" {...bind("start_date")} /></Field>
              <Field label="Valid until"><Input type="date" {...bind("end_date")} /></Field>
            </div>
          </Card>
          <Card className="p-6 space-y-6">
            <div className="flex items-center gap-2.5"><span className="grid place-items-center size-8 rounded-lg bg-brand-500/15 text-brand-300"><FileText className="size-4" /></span><h3 className="font-display font-semibold">Agreement clauses</h3></div>
            {RICH.map((r) => (
              <div key={r.key}>
                <div className="flex items-baseline justify-between mb-2"><label className="field-label mb-0">{r.label}</label><span className="text-[11.5px] text-fg-4">{r.hint}</span></div>
                <RichTextEditor value={values[r.key]} onChange={(h) => set(r.key, h)} minHeight={r.min} />
              </div>
            ))}
          </Card>
          <Card className="p-6">
            <div className="flex items-center gap-2.5 mb-5"><span className="grid place-items-center size-8 rounded-lg bg-brand-500/15 text-brand-300"><PenLine className="size-4" /></span><h3 className="font-display font-semibold">Our authorised signatory</h3></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Name"><Input {...bind("signatory")} /></Field>
              <Field label="Designation"><Input {...bind("signatory_designation")} /></Field>
            </div>
          </Card>
        </div>
        <div className="xl:sticky xl:top-24">
          <div className="flex items-center gap-2 mb-3 text-[12.5px] text-fg-3"><Eye className="size-4" /> Live PDF preview</div>
          <PdfPreview endpoint="/mous/preview" payload={{ ...values, number: number ?? "" }} />
        </div>
      </div>
    </form>
  );
}
