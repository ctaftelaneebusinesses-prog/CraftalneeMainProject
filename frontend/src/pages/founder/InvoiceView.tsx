import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Check, Download, Eye, Mail, Pencil, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, inr } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import { Button, Card, PageHeader, PageSkeleton } from "@/components/ui/core";
import { useConfirm } from "@/components/ui/overlay";
import { InvoiceStatusBadge, MarkPaidModal, useInvalidateInvoices } from "./Invoices";

export default function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const invalidate = useInvalidateInvoices();
  const [paying, setPaying] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["invoice", id], queryFn: () => api.get<{ invoice: Invoice }>(`/invoices/${id}`) });
  const act = useMutation({
    mutationFn: (action: "unpaid" | "cancel") => api.post<{ invoice: Invoice; message?: string }>(`/invoices/${id}/${action}`),
    onSuccess: (r) => { invalidate(); toast.success(r.message ?? (r.invoice.status === "cancelled" ? "Invoice cancelled" : "Invoice restored")); },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/invoices/${id}`),
    onSuccess: () => { invalidate(); toast.success("Invoice deleted"); navigate("/finance/invoices"); },
  });
  if (isLoading || !data) return <PageSkeleton />;
  const i = data.invoice;
  const mail = i.client_email
    ? `mailto:${i.client_email}?subject=${encodeURIComponent(`Invoice ${i.number}`)}&body=${encodeURIComponent(`Hello,\n\nPlease find invoice ${i.number} for ${inr(i.total)}${i.due_date ? `, due on ${fmtDate(i.due_date)}` : ""}.\n\nThank you.`)}`
    : null;

  return (
    <>
      <PageHeader back={{ to: "/finance/invoices", label: "Invoices" }}
        eyebrow={<span className="font-mono normal-case tracking-normal">{i.number}</span>}
        title={<span className="flex items-center gap-3 flex-wrap">{i.client_name}<InvoiceStatusBadge i={i} /></span>}
        subtitle={`${inr(i.total)} · issued ${fmtDate(i.invoice_date)}${i.due_date ? ` · due ${fmtDate(i.due_date)}` : ""}${i.status === "paid" && i.paid_date ? ` · paid ${fmtDate(i.paid_date)}${i.payment_method ? ` via ${i.payment_method}` : ""}` : ""}`}
        actions={<div className="flex flex-wrap gap-2">
          {i.status === "unpaid" && <Button variant="primary" icon={<Check />} onClick={() => setPaying(true)}>Mark paid</Button>}
          {i.file_url && <Button icon={<Download />} href={`${i.file_url}&dl=1`} download>Download PDF</Button>}
          {mail && <Button icon={<Mail />} href={mail}>Email client</Button>}
        </div>} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
        <Card className="p-3">
          {i.file_url ? <iframe title={`Invoice ${i.number}`} src={i.file_url} className="w-full h-[80vh] rounded-xl bg-[#fff]" />
            : <div className="p-10 text-center text-fg-3">No PDF yet.</div>}
        </Card>

        <div className="space-y-4">
          <Card className="p-5 space-y-2.5 text-[13.5px]">
            <div className="flex justify-between text-fg-3"><span>Subtotal</span><span className="tnum">{inr(i.subtotal)}</span></div>
            {i.discount > 0 && <div className="flex justify-between text-fg-3"><span>Discount</span><span className="tnum">− {inr(i.discount)}</span></div>}
            {i.tax_rate > 0 && <div className="flex justify-between text-fg-3"><span>{i.tax_label} @ {i.tax_rate}%</span><span className="tnum">{inr(i.tax_amount)}</span></div>}
            <div className="flex justify-between pt-2 border-t divider font-display font-bold text-[18px]"><span>Total</span><span className="tnum">{inr(i.total)}</span></div>
            {i.income && <p className="pt-2 text-[12.5px] text-fg-4">Recorded in Income as <Link to="/finance/income" className="text-brand-300 hover:underline font-mono">{i.income.code}</Link>.</p>}
          </Card>

          <Card className="p-5 space-y-2">
            {i.file_url && <Button className="w-full" icon={<Eye />} href={i.file_url}>Open PDF in new tab</Button>}
            {i.status === "unpaid" && <Button className="w-full" icon={<Pencil />} to={`/finance/invoices/${i.id}/edit`}>Edit invoice</Button>}
            {i.status === "paid" && (
              <Button className="w-full" icon={<Undo2 />} loading={act.isPending} onClick={async () => {
                if (await confirm({ title: `Mark ${i.number} unpaid?`, message: `Its income entry (${inr(i.total)}) will be removed from Finance. Use this if the payment was recorded by mistake.`, confirmText: "Mark unpaid" })) act.mutate("unpaid");
              }}>Mark unpaid</Button>
            )}
            {i.status !== "paid" && (
              <Button className="w-full" icon={i.status === "cancelled" ? <RotateCcw /> : <Ban />} loading={act.isPending} onClick={async () => {
                if (i.status === "cancelled" || await confirm({ title: `Cancel ${i.number}?`, message: "It stays on record (stamped CANCELLED on the PDF) but no longer counts as outstanding.", confirmText: "Cancel invoice" })) act.mutate("cancel");
              }}>{i.status === "cancelled" ? "Restore invoice" : "Cancel invoice"}</Button>
            )}
            {i.status !== "paid" && (
              <Button className="w-full" variant="danger" icon={<Trash2 />} loading={del.isPending} onClick={async () => {
                if (await confirm({ title: `Delete ${i.number}?`, message: "This removes the invoice and its PDF for good. Prefer Cancel to keep a record.", danger: true, confirmText: "Delete forever", requireText: i.number })) del.mutate();
              }}>Delete</Button>
            )}
          </Card>
        </div>
      </div>

      <MarkPaidModal invoice={paying ? i : null} onClose={() => setPaying(false)} />
    </>
  );
}
