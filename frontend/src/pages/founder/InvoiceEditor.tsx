import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Check, GripVertical, ListOrdered, Plus, ReceiptText, Trash2, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { cn, inr, today } from "@/lib/format";
import type { Invoice, InvoiceClient } from "@/lib/types";
import { Button, Card, Field, Input, MoneyInput, PageHeader, PageSkeleton, Textarea } from "@/components/ui/core";
import { PdfPreview } from "@/components/PdfPreview";
import { useInvalidateInvoices } from "./Invoices";

interface Line { key: number; description: string; qty: string; rate: string }
let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, description: "", qty: "1", rate: "" });
const EMPTY = {
  client_name: "", client_address: "", client_email: "", client_phone: "", client_gstin: "",
  invoice_date: today(), due_date: "", tax_label: "GST", tax_rate: "18", discount: "", notes: "", terms: "",
};
type Values = typeof EMPTY;
const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
const plusDays = (iso: string, days: number) => { const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

function Section({ icon, title, children, action }: { icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2.5 mb-5">
        <span className="grid place-items-center size-8 rounded-lg bg-brand-500/15 text-brand-300 [&>svg]:size-4">{icon}</span>
        <h3 className="font-display font-semibold flex-1">{title}</h3>
        {action}
      </div>
      {children}
    </Card>
  );
}

export default function InvoiceEditor() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const invalidate = useInvalidateInvoices();
  const [v, setV] = useState<Values>(EMPTY);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const set = (k: keyof Values, value: string) => setV((old) => ({ ...old, [k]: value }));
  const bind = (k: keyof Values) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value) });

  const fresh = useQuery({ queryKey: ["invoice-new"], queryFn: () => api.get<{ number_preview: string; defaults: Partial<Record<keyof Values, string | number>>; clients: InvoiceClient[] }>("/invoices/new"), enabled: !editing, staleTime: 0 });
  const existing = useQuery({ queryKey: ["invoice", id], queryFn: () => api.get<{ invoice: Invoice }>(`/invoices/${id}`), enabled: editing });

  useEffect(() => {
    const d = fresh.data?.defaults;
    if (!d || editing) return;
    setV((old) => ({ ...old, tax_label: String(d.tax_label ?? "GST"), tax_rate: String(d.tax_rate ?? 18), notes: String(d.notes ?? ""), terms: String(d.terms ?? ""), due_date: plusDays(old.invoice_date, 15) }));
  }, [fresh.data, editing]);
  useEffect(() => {
    const i = existing.data?.invoice;
    if (!i) return;
    if (i.status === "paid") { toast.error("Paid invoices can't be edited. Mark it unpaid first."); navigate(`/finance/invoices/${i.id}`, { replace: true }); return; }
    setV({ client_name: i.client_name, client_address: i.client_address ?? "", client_email: i.client_email ?? "", client_phone: i.client_phone ?? "",
      client_gstin: i.client_gstin ?? "", invoice_date: i.invoice_date, due_date: i.due_date ?? "", tax_label: i.tax_label, tax_rate: String(i.tax_rate),
      discount: i.discount ? String(i.discount) : "", notes: i.notes ?? "", terms: i.terms ?? "" });
    setLines(i.items.length ? i.items.map((l) => ({ key: nextKey++, description: l.description, qty: String(l.qty), rate: String(l.rate) })) : [blank()]);
  }, [existing.data, navigate]);

  // Live totals (the server recalculates the same way).
  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + Math.round(num(l.qty) * num(l.rate) * 100) / 100, 0);
    const taxable = Math.max(subtotal - num(v.discount), 0);
    const tax = Math.round(taxable * num(v.tax_rate)) / 100;
    return { subtotal, taxable, tax, total: taxable + tax };
  }, [lines, v.discount, v.tax_rate]);

  const payload = { ...v, id: id ?? "", items: lines.filter((l) => l.description.trim() || l.rate.trim()).map(({ description, qty, rate }) => ({ description, qty, rate })) };
  const save = useMutation({
    mutationFn: () => editing ? api.put<{ invoice: Invoice }>(`/invoices/${id}`, payload) : api.post<{ invoice: Invoice }>("/invoices", payload),
    onSuccess: (r) => { invalidate(); toast.success(editing ? `${r.invoice.number} updated` : `${r.invoice.number} created`); navigate(`/finance/invoices/${r.invoice.id}`); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickClient = (name: string) => {
    const c = fresh.data?.clients.find((x) => x.client_name === name);
    if (c) setV((old) => ({ ...old, client_name: c.client_name, client_address: c.client_address ?? "", client_email: c.client_email ?? "", client_phone: c.client_phone ?? "", client_gstin: c.client_gstin ?? "" }));
  };

  if ((editing && existing.isLoading) || (!editing && fresh.isLoading)) return <PageSkeleton />;
  const number = editing ? existing.data?.invoice.number : fresh.data?.number_preview;
  const gst = v.tax_label.trim().toUpperCase() === "GST";

  return (
    <form onSubmit={submit}>
      <PageHeader back={{ to: editing ? `/finance/invoices/${id}` : "/finance/invoices", label: editing ? number ?? "Invoice" : "Invoices" }}
        eyebrow={number ? <span className="font-mono normal-case tracking-normal">{number}</span> : "Invoice"}
        title={editing ? "Edit invoice" : "New invoice"} subtitle="The preview on the right is the real PDF your client will receive."
        actions={<Button variant="primary" type="submit" icon={<Check />} loading={save.isPending}>{editing ? "Save & regenerate PDF" : "Create invoice"}</Button>} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-5">
          <Section icon={<Building2 />} title="Bill to">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Client / company" className="sm:col-span-2" hint={fresh.data?.clients.length ? "Start typing to reuse a previous client's details." : undefined}>
                <Input {...bind("client_name")} required list="invoice-clients" placeholder="e.g. Acme Technologies Pvt Ltd"
                  onChange={(e) => { set("client_name", e.target.value); pickClient(e.target.value); }} />
                <datalist id="invoice-clients">{fresh.data?.clients.map((c) => <option key={c.client_name} value={c.client_name} />)}</datalist>
              </Field>
              <Field label="Address" optional className="sm:col-span-2"><Textarea {...bind("client_address")} rows={2} className="min-h-[64px]" /></Field>
              <Field label="Email" optional><Input {...bind("client_email")} type="email" /></Field>
              <Field label="Phone" optional><Input {...bind("client_phone")} type="tel" /></Field>
              <Field label="Client GSTIN" optional><Input {...bind("client_gstin")} className="font-mono uppercase" maxLength={20} placeholder="29ABCDE1234F1Z5" /></Field>
              <div />
              <Field label="Invoice date"><Input {...bind("invoice_date")} type="date" required /></Field>
              <Field label="Due date" optional hint={<span className="flex gap-2">{[7, 15, 30].map((d) => <button key={d} type="button" className="text-brand-300 hover:underline" onClick={() => set("due_date", plusDays(v.invoice_date, d))}>+{d} days</button>)}</span>}>
                <Input {...bind("due_date")} type="date" min={v.invoice_date} />
              </Field>
            </div>
          </Section>

          <Section icon={<ListOrdered />} title="Items" action={<Button size="sm" icon={<Plus />} onClick={() => setLines((ls) => [...ls, blank()])}>Add line</Button>}>
            <div className="hidden sm:grid grid-cols-[16px_minmax(0,1fr)_72px_120px_110px_32px] gap-2 px-1 pb-2 text-[11.5px] uppercase tracking-wider text-fg-4">
              <span /><span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span><span />
            </div>
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_72px_120px_32px] sm:grid-cols-[16px_minmax(0,1fr)_72px_120px_110px_32px] gap-2 items-center">
                  <GripVertical className="hidden sm:block size-4 text-fg-4" />
                  <Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="e.g. Website development" className="input-sm col-span-4 sm:col-span-1" />
                  <Input value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} inputMode="decimal" className="input-sm text-right tnum" aria-label="Quantity" />
                  <MoneyInput value={l.rate} onChange={(x) => setLine(l.key, { rate: x })} className="input-sm" placeholder="0" aria-label="Rate" />
                  <span className="hidden sm:block text-right tnum text-[13.5px] font-medium">{inr(num(l.qty) * num(l.rate))}</span>
                  <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t divider grid grid-cols-1 sm:grid-cols-[1fr_260px] gap-5">
              <div className="grid grid-cols-3 gap-3 content-start">
                <Field label="Tax name"><Input {...bind("tax_label")} maxLength={30} className="input-sm" /></Field>
                <Field label="Rate %"><Input {...bind("tax_rate")} inputMode="decimal" className="input-sm text-right tnum" /></Field>
                <Field label="Discount"><MoneyInput value={v.discount} onChange={(x) => set("discount", x)} className="input-sm" placeholder="0" /></Field>
                <p className="col-span-3 text-[12px] text-fg-4">{gst ? "GST is shown on the PDF as CGST + SGST (half each). Use tax name “IGST” for inter-state clients, or rate 0 for no tax." : "Set rate to 0 for no tax."}</p>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2 text-[13.5px]">
                <Row label="Subtotal" value={inr(totals.subtotal)} />
                {num(v.discount) > 0 && <Row label="Discount" value={`− ${inr(num(v.discount))}`} />}
                {num(v.tax_rate) > 0 && <Row label={`${v.tax_label || "Tax"} @ ${num(v.tax_rate)}%`} value={inr(totals.tax)} />}
                <div className="flex justify-between pt-2 border-t divider font-display font-bold text-[18px]"><span>Total</span><span className="tnum text-grad">{inr(totals.total)}</span></div>
              </div>
            </div>
          </Section>

          <Section icon={<Wallet />} title="Payment & terms">
            <div className="space-y-5">
              <Field label="Payment details" optional hint="Bank account, IFSC, UPI ID… Carried over to your next invoice.">
                <Textarea {...bind("notes")} rows={3} className="min-h-[84px]" placeholder={"Bank: …  A/C: …  IFSC: …\nUPI: …"} />
              </Field>
              <Field label="Terms & conditions" optional><Textarea {...bind("terms")} rows={3} className="min-h-[84px]" /></Field>
            </div>
          </Section>
        </div>

        <div className="xl:sticky xl:top-6">
          <Card className="p-3">
            <div className={cn("flex items-center gap-2 px-2 pb-2 text-[12.5px] text-fg-3")}><ReceiptText className="size-4" />Live PDF preview</div>
            <PdfPreview endpoint="/invoices/preview" payload={payload} />
          </Card>
        </div>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-fg-2"><span>{label}</span><span className="tnum">{value}</span></div>;
}
