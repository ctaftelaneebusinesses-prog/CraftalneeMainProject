import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, CalendarRange, Download, Eye, MapPin, Pencil, PenLine, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Mou } from "@/lib/types";
import { Button, Card, CardHeader, PageHeader, PageSkeleton } from "@/components/ui/core";
import { mouStatus } from "./Mous";
import { DeleteDocButton } from "@/components/DeleteDocButton";

export default function MouView() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["mou", id], queryFn: () => api.get<{ mou: Mou }>(`/mous/${id}`) });
  const archive = useMutation({
    mutationFn: () => api.post<{ mou: Mou }>(`/mous/${id}/archive`),
    onSuccess: (r) => { qc.setQueryData(["mou", id], r); qc.invalidateQueries({ queryKey: ["mous"] }); toast.success(r.mou.archived ? "MOU archived" : "MOU restored"); },
  });
  if (isLoading || !data) return <PageSkeleton />;
  const m = data.mou;
  const sections: [string, string | null][] = [["Purpose", m.purpose], ["Scope of work", m.scope], ["Payment terms", m.payment_terms], ["Roles & responsibilities", m.responsibilities], ["Terms & conditions", m.terms]];
  const listy = (t: string) => t.includes("\n");

  return (
    <>
      <PageHeader back={{ to: "/mous", label: "MOU" }} eyebrow={<span className="font-mono normal-case tracking-normal">{m.number}</span>}
        title={m.party_name} subtitle={<span className="inline-flex items-center gap-2">{mouStatus(m)} <span>{fmtDate(m.start_date)} → {fmtDate(m.end_date)}</span></span>}
        actions={<>
          <Button icon={m.archived ? <ArchiveRestore /> : <Archive />} loading={archive.isPending} onClick={() => archive.mutate()}>{m.archived ? "Restore" : "Archive"}</Button>
          <Button icon={<Pencil />} to={`/mous/${m.id}/edit`}>Edit</Button>
          <DeleteDocButton full kind="mou" id={m.id} number={m.number} label="MOU" onDeleted={() => navigate("/mous")} />
          <Button icon={<Eye />} href={m.file_url}>View PDF</Button>
          <Button variant="primary" icon={<Download />} href={`${m.file_url}&dl=1`} download>Download</Button>
        </>} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <Card className="p-7 sm:p-9">
          <div className="text-center mb-8">
            <div className="eyebrow">Memorandum of Understanding</div>
            <div className="font-display text-[22px] font-bold mt-2">{m.party_name}</div>
          </div>
          {sections.filter(([, t]) => t && t.trim()).map(([label, text], i) => (
            <section key={label} className="mb-7 last:mb-0">
              <h3 className="flex items-center gap-3 font-display font-semibold text-[15px] mb-2.5">
                <span className="grid place-items-center size-6 rounded-md text-[11.5px] font-bold text-on-accent" style={{ background: "var(--grad)" }}>{i + 1}</span>{label}
              </h3>
              {/<(p|div|ul|ol|li|b|br|font)\b/i.test(text!) ? (
                // Stored clauses are sanitised server-side to a small formatting allow-list.
                <div className="rte pl-9 text-fg-2" dangerouslySetInnerHTML={{ __html: text! }} />
              ) : listy(text!) ? (
                <ol className="space-y-1.5 pl-9 list-decimal marker:text-fg-4 text-fg-2">{text!.split("\n").filter((l) => l.trim()).map((l, j) => <li key={j}>{l.replace(/^[\s\-•*\d.)]+/, "")}</li>)}</ol>
              ) : <p className="pl-9 text-fg-2 leading-relaxed whitespace-pre-line">{text}</p>}
            </section>
          ))}
          {!sections.some(([, t]) => t && t.trim()) && <p className="text-center text-fg-3">No agreement text yet — edit this MOU to add it.</p>}
        </Card>

        <div className="space-y-4 xl:sticky xl:top-24">
          <Card>
            <CardHeader title="Summary" />
            <div className="px-6 pb-6 space-y-4 text-[13.5px]">
              {[[<UserRound />, "Contact person", m.contact_person], [<MapPin />, "Address", m.address], [<CalendarRange />, "Period", `${fmtDate(m.start_date)} → ${fmtDate(m.end_date)}`],
                [<PenLine />, "Our signatory", m.signatory ? `${m.signatory}${m.signatory_designation ? ` · ${m.signatory_designation}` : ""}` : null]].map(([icon, k, v], i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-fg-4 mt-0.5 [&>svg]:size-4">{icon}</span>
                  <div><div className="text-[12px] text-fg-4">{k as string}</div><div className="whitespace-pre-line">{(v as string) || "—"}</div></div>
                </div>
              ))}
              <div className="pt-3 border-t divider text-[12px] text-fg-4">Last updated {fmtDateTime(m.updated_at)}</div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
