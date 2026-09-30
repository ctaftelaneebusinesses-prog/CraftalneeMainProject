import type { ReactNode } from "react";
import { BriefcaseBusiness, DoorOpen, FileText, Send } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, PageHeader, PageSkeleton } from "@/components/ui/core";
import { DocRow } from "@/components/DocRow";
import { useMe } from "./useMe";

function Group({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={icon} title={title} />
      <div className="border-t divider divide-y divide-white/[0.05]">
        {children.length ? children : <div className="px-5 py-6 text-[13px] text-fg-4">Not available yet.</div>}
      </div>
    </Card>
  );
}

export default function PortalDocuments() {
  const { data, isLoading } = useMe();
  if (isLoading || !data) return <PageSkeleton />;
  const d = data.documents;
  return (
    <>
      <PageHeader eyebrow="My documents" title="Documents" subtitle="Your letters and documents shared by the company. Payslips are under My payslips." />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Group icon={<Send />} title="Offer letter">{d.offer.map((l, i) => <DocRow key={l.id} index={i} kind="offer" title="Offer letter" sub={`${l.number} · ${fmtDate(l.letter_date)}`} url={l.file_url} />)}</Group>
        <Group icon={<BriefcaseBusiness />} title="Joining letter">{d.joining.map((l, i) => <DocRow key={l.id} index={i} kind="joining" title="Joining letter" sub={`${l.number} · ${fmtDate(l.letter_date)}`} url={l.file_url} />)}</Group>
        {d.relieving?.length > 0 && (
          <div className="xl:col-span-2">
            <Group icon={<DoorOpen />} title="Relieving letter">{d.relieving.map((l, i) => <DocRow key={l.id} index={i} kind="relieving" title="Relieving letter" sub={`${l.number} · ${fmtDate(l.letter_date)}`} url={l.file_url} />)}</Group>
          </div>
        )}
        <div className="xl:col-span-2">
          <Group icon={<FileText />} title="Other documents">{d.other.map((x, i) => <DocRow key={x.id} index={i} kind="doc" title={x.title} sub={`${fmtDate(x.created_at)}${x.notes ? ` · ${x.notes}` : ""}`} url={x.file_url} />)}</Group>
        </div>
      </div>
    </>
  );
}
