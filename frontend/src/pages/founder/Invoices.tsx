import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Check, Clock3, Download, FileText, Plus, ReceiptText } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDate, inr, today } from "@/lib/format";
import { useDebounced, useMeta } from "@/lib/hooks";
import type { Invoice, InvoiceSummary } from "@/lib/types";
import { AnimatedNumber, Badge, Button, Card, EmptyState, Field, Input, PageHeader, SearchInput, Segmented, Select, Skeleton } from "@/components/ui/core";
import { Modal } from "@/components/ui/overlay";

type Filter = "all" | "unpaid" | "overdue" | "paid" | "cancelled";

export function InvoiceStatusBadge({ i }: { i: Pick<Invoice, "status" | "overdue"> }) {
  if (i.status === "paid") return <Badge tone="good" dot>Paid</Badge>;
  if (i.status === "cancelled") return <Badge dot>Cancelled</Badge>;
  return i.overdue ? <Badge tone="bad" dot>Overdue</Badge> : <Badge tone="warn" dot>Unpaid</Badge>;
}

export function useInvalidateInvoices() {
  const qc = useQueryClient();
  return () => ["invoices", "invoice", "income", "finance", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/** Record payment: sets the paid date/method and adds the amount to Income. */
export function MarkPaidModal({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const meta = useMeta();
  const invalidate = useInvalidateInvoices();
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState("");
  const m = useMutation({
    mutationFn: () => api.post<{ invoice: Invoice; message: string }>(`/invoices/${invoice!.id}/paid`, { paid_date: date, payment_method: method }),
    onSuccess: (r) => { invalidate(); toast.success(r.message); onClose(); },
  });
  return (
    <Modal open={!!invoice} onClose={onClose} title={`Mark ${invoice?.number} paid`}
      subtitle={invoice ? `${invoice.client_name} · ${inr(invoice.total)} will be added to Income as Received.` : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Check />} loading={m.isPending} onClick={() => m.mutate()}>Mark paid</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Payment date"><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Method" optional><Select value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Choose…" options={meta.payment_methods} /></Field>
      </div>
    </Modal>
  );
}

export default function Invoices() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [paying, setPaying] = useState<Invoice | null>(null);
  const dq = useDebounced(q);
  const { data, isLoading } = useQuery({
    queryKey: ["invoices", filter, dq],
    queryFn: () => api.get<{ invoices: Invoice[]; summary: InvoiceSummary }>(`/invoices${qs({ status: filter, q: dq })}`),
    placeholderData: keepPreviousData,
  });
  const s = data?.summary;
  const rows = data?.invoices ?? [];

  return (
    <>
      <PageHeader eyebrow="Finance" title="Invoices" subtitle="Bill clients, send the PDF and mark it paid. Payment is added to Income automatically."
        actions={<Button variant="primary" icon={<Plus />} to="/finance/invoices/new">New invoice</Button>} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <Card glow className="p-5"><div className="flex items-center gap-2 text-[12.5px] text-fg-3"><Clock3 className="size-4 text-warn" />Outstanding</div>
          <div className="font-display font-bold text-[26px] mt-1"><AnimatedNumber value={s?.outstanding ?? 0} /></div>
          <div className="text-[12px] text-fg-4">{s?.unpaid_count ?? 0} unpaid invoice{s?.unpaid_count === 1 ? "" : "s"}</div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 text-[12.5px] text-fg-3"><AlertTriangle className="size-4 text-bad" />Overdue</div>
          <div className="font-display font-bold text-[26px] mt-1 text-bad"><AnimatedNumber value={s?.overdue ?? 0} /></div>
          <div className="text-[12px] text-fg-4">{s?.overdue_count ?? 0} past the due date</div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 text-[12.5px] text-fg-3"><BadgeCheck className="size-4 text-good" />Paid this year</div>
          <div className="font-display font-bold text-[26px] mt-1 text-good"><AnimatedNumber value={s?.paid_this_year ?? 0} /></div>
          <div className="text-[12px] text-fg-4">Counted in Income</div></Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Segmented layoutId="invoice-filter" value={filter} onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "unpaid", label: "Unpaid" }, { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid" }, { value: "cancelled", label: "Cancelled" }]} />
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search number, client, item…" className="w-full sm:w-[280px]" />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : !rows.length ? <EmptyState icon={<ReceiptText />} title={filter === "all" && !dq ? "No invoices yet" : "Nothing here"}
            text={filter === "all" && !dq ? "Create your first invoice — it's numbered automatically and uses your letterhead." : "Try another filter or search."}
            action={filter === "all" && !dq && <Button variant="primary" icon={<Plus />} to="/finance/invoices/new">New invoice</Button>} />
          : (
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th>Due</th><th>Status</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>{rows.map((i) => (
                <tr key={i.id} className="group cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) navigate(`/finance/invoices/${i.id}`); }}>
                  <td className="font-mono text-[12.5px] whitespace-nowrap">{i.number}</td>
                  <td><div className="font-medium">{i.client_name}</div><div className="text-[12.5px] text-fg-4 truncate max-w-[260px]">{i.items.map((l) => l.description).join(", ")}</div></td>
                  <td className="text-fg-3 whitespace-nowrap">{fmtDate(i.invoice_date)}</td>
                  <td className="text-fg-3 whitespace-nowrap">{i.due_date ? fmtDate(i.due_date) : "—"}</td>
                  <td><InvoiceStatusBadge i={i} /></td>
                  <td className="text-right tnum font-semibold">{inr(i.total)}</td>
                  <td><div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {i.file_url && <Button size="sm" variant="ghost" iconOnly icon={<Download />} title="Download PDF" href={`${i.file_url}&dl=1`} download />}
                    {i.status === "unpaid" && <Button size="sm" icon={<Check />} onClick={() => setPaying(i)}>Mark paid</Button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>
      {!isLoading && rows.length > 0 && <p className="mt-3 text-[12px] text-fg-4 flex items-center gap-1.5"><FileText className="size-3.5" />Click an invoice to view, edit or cancel it.</p>}

      <MarkPaidModal invoice={paying} onClose={() => setPaying(null)} />
    </>
  );
}
