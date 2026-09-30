import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { BriefcaseBusiness, FolderOpen, Handshake, Send } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { DocItem } from "@/lib/types";
import { Badge, Button, Card, EmptyState, FileActions, PageHeader, SearchInput, Segmented, Skeleton } from "@/components/ui/core";
import { DocIcon } from "@/components/DocRow";
import { DELETABLE, DeleteDocButton, type DeletableKind } from "@/components/DeleteDocButton";

type Cat = "all" | "mou" | "offer" | "joining" | "relieving" | "payslip" | "other";
const CATS: { value: Cat; label: string }[] = [
  { value: "all", label: "All" }, { value: "mou", label: "MOU" }, { value: "offer", label: "Offer letters" },
  { value: "joining", label: "Joining letters" }, { value: "relieving", label: "Relieving" }, { value: "payslip", label: "Payslips" }, { value: "other", label: "Other" },
];

export default function Documents() {
  const [cat, setCat] = useState<Cat>("all");
  const [archived, setArchived] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, isLoading } = useQuery({
    queryKey: ["documents", cat, archived, dq],
    queryFn: () => api.get<{ items: DocItem[]; counts: Record<Cat, number> }>(`/documents${qs({ category: cat, show: archived === "archived" ? "archived" : "", q: dq })}`),
    placeholderData: keepPreviousData,
  });
  const items = data?.items ?? [];
  const linkFor = (d: DocItem) => d.kind === "mou" ? `/mous/${d.id}` : d.employee_id ? `/employees/${d.employee_id}` : "#";

  return (
    <>
      <PageHeader eyebrow="Documents" title="Document Center" subtitle="Every generated and uploaded document, searchable in one place."
        actions={<>
          <Button icon={<Handshake />} to="/mous/new">New MOU</Button>
          <Button icon={<BriefcaseBusiness />} to="/letters/joining/new">Joining letter</Button>
          <Button variant="primary" icon={<Send />} to="/letters/offer/new">Offer letter</Button>
        </>} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Segmented layoutId="doc-cat" value={cat} onChange={setCat} options={CATS.map((c) => ({ ...c, count: data?.counts[c.value] }))} />
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Segmented layoutId="doc-arch" value={archived} onChange={setArchived} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search number, employee, organisation…" className="w-full sm:w-[340px]" />
      </div>

      {isLoading ? <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
        : items.length === 0 ? <Card><EmptyState icon={<FolderOpen />} title="No documents found" text={q ? "Try another search term or category." : "Generated letters, MOUs and payslips will appear here."} /></Card>
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((d, i) => (
              <motion.div key={`${d.kind}-${d.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}>
                <Card hover className="group p-5 h-full flex flex-col">
                  <div className="flex items-start gap-4">
                    <DocIcon kind={d.kind} size={46} />
                    <div className="min-w-0 flex-1">
                      <Badge className="mb-1.5">{d.type}</Badge>
                      <div className="font-medium truncate" title={d.number}>{d.kind === "doc" ? d.number : <span className="font-mono text-[13px]">{d.number}</span>}</div>
                    </div>
                  </div>
                  <Link to={linkFor(d)} className="mt-4 text-[13.5px] text-fg-2 hover:text-brand-300 truncate">{d.title}</Link>
                  <div className="text-[12.5px] text-fg-4 truncate">{d.subtitle || " "}</div>
                  <div className="mt-auto pt-4 flex items-center justify-between border-t divider mt-4">
                    <span className="text-[12px] text-fg-4">{fmtDate(d.date)}</span>
                    <div className="flex items-center gap-1">
                      <FileActions url={d.file_url} />
                      {DELETABLE.has(d.kind) && <DeleteDocButton kind={d.kind as DeletableKind} id={d.id} number={d.number} label={d.type.toLowerCase()} />}
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
    </>
  );
}
