import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Check, Clock3, Lock, Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDate, inr, today } from "@/lib/format";
import { useDebounced, useMeta } from "@/lib/hooks";
import type { Income, Period } from "@/lib/types";
import { AnimatedNumber, Badge, Button, Card, EmptyState, Field, Input, MoneyInput, PageHeader, SearchInput, Select, Skeleton, Textarea, type Tone } from "@/components/ui/core";
import { Drawer, useConfirm } from "@/components/ui/overlay";
import { PeriodPicker, type PeriodKey, type PeriodValue } from "@/components/PeriodPicker";

export const STATUS_TONE: Record<string, Tone> = { Received: "good", Pending: "warn", "Partially Received": "info" };
const EMPTY = { date: today(), source: "", client: "", description: "", amount: "", payment_status: "Received", notes: "" };

export default function IncomePage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const meta = useMeta();
  const [p, setP] = useState<PeriodValue>({ period: (params.get("period") as PeriodKey) || "all", start: params.get("start") ?? "", end: params.get("end") ?? "" });
  const [q, setQ] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Income | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const dq = useDebounced(q);

  useEffect(() => { if (params.get("new")) { setEditing("new"); params.delete("new"); setParams(params, { replace: true }); } }, [params, setParams]);
  useEffect(() => {
    if (editing === "new") setForm({ ...EMPTY, date: today() });
    else if (editing) setForm({ date: editing.date, source: editing.source, client: editing.client ?? "", description: editing.description ?? "", amount: String(editing.amount), payment_status: editing.payment_status, notes: editing.notes ?? "" });
  }, [editing]);

  const { data, isLoading } = useQuery({
    queryKey: ["income", p, dq, status],
    queryFn: () => api.get<{ rows: Income[]; period: Period; total: number; received: number; pending: number }>(`/income${qs({ ...(p.period === "custom" ? p : { period: p.period }), q: dq, status })}`),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => { ["income", "finance", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const save = useMutation({
    mutationFn: () => editing && editing !== "new" ? api.put<{ row: Income }>(`/income/${editing.id}`, form) : api.post<{ row: Income }>("/income", form),
    onSuccess: (r) => { invalidate(); setEditing(null); toast.success(`Income ${r.row.code} saved`); },
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/income/${id}`), onSuccess: () => { invalidate(); toast.success("Income deleted"); } });
  const f = (k: keyof typeof EMPTY) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <>
      <PageHeader eyebrow="Finance" title="Income" subtitle={data ? `${data.period.label} · ${data.rows.length} entries` : "Money coming in"}
        actions={<Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Add income</Button>} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <Card glow className="p-5"><div className="flex items-center gap-2 text-[12.5px] text-fg-3"><ArrowUpRight className="size-4 text-good" />Received</div><div className="font-display font-bold text-[26px] mt-1 text-good"><AnimatedNumber value={data?.received ?? 0} /></div><div className="text-[12px] text-fg-4">Counted in balance</div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 text-[12.5px] text-fg-3"><Clock3 className="size-4 text-warn" />Pending / partial</div><div className="font-display font-bold text-[26px] mt-1"><AnimatedNumber value={data?.pending ?? 0} /></div><div className="text-[12px] text-fg-4">Not yet counted</div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 text-[12.5px] text-fg-3"><TrendingUp className="size-4 text-brand-300" />Total billed</div><div className="font-display font-bold text-[26px] mt-1"><AnimatedNumber value={data?.total ?? 0} /></div><div className="text-[12px] text-fg-4">{data?.period.label}</div></Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <PeriodPicker value={p} onChange={setP} />
        <Select className="input-sm h-[38px] w-[170px]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={meta.income_statuses} />
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search source, client…" className="w-full sm:w-[260px]" />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : !data?.rows.length ? <EmptyState icon={<TrendingUp />} title="No income recorded" text="Record project payments, training fees and other income." action={<Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Add income</Button>} />
          : (
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>ID</th><th>Date</th><th>Source</th><th>Client</th><th>Status</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id} className="group">
                  <td className="font-mono text-[12px] text-fg-4">{r.code}</td>
                  <td className="text-fg-3 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td><div className="font-medium">{r.source}</div>{r.description && <div className="text-[12.5px] text-fg-4 truncate max-w-[280px]">{r.description}</div>}
                    {r.invoice && <Link to={`/finance/invoices/${r.invoice.id}`} className="text-[12px] text-brand-300 hover:underline">From invoice →</Link>}</td>
                  <td className="text-fg-2">{r.client ?? "—"}</td>
                  <td><Badge tone={STATUS_TONE[r.payment_status]} dot>{r.payment_status}</Badge></td>
                  <td className="text-right tnum font-semibold">{inr(r.amount)}</td>
                  <td><div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {r.invoice ? <Badge tone="brand"><Lock className="size-3" /> Locked</Badge> : (<>
                      <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} title="Edit" onClick={() => setEditing(r)} />
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete" onClick={async () => { if (await confirm({ title: `Delete ${r.code}?`, message: `${r.source} · ${inr(r.amount)}`, danger: true, confirmText: "Delete" })) del.mutate(r.id); }} />
                    </>)}
                  </div></td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5} className="text-fg-3">Total</td><td className="text-right tnum">{inr(data.total)}</td><td /></tr></tfoot>
            </table></div>
          )}
      </Card>

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? `Edit ${editing.code}` : "Add income"}
        subtitle="Only “Received” counts toward the balance."
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" icon={<Check />} loading={save.isPending} onClick={() => save.mutate()}>Save income</Button></>}>
        <div className="space-y-5">
          <Field label="Amount"><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} className="h-14 text-[22px] font-display font-semibold" autoFocus placeholder="0" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date"><Input type="date" {...f("date")} /></Field>
            <Field label="Payment status"><Select {...f("payment_status")} options={meta.income_statuses} /></Field>
          </div>
          <Field label="Source"><Input {...f("source")} list="income-sources" placeholder="e.g. Website Project" />
            <datalist id="income-sources">{["Website Project", "Software Service", "Training", "Consulting", "Maintenance"].map((s) => <option key={s} value={s} />)}</datalist></Field>
          <Field label="Client / customer" optional><Input {...f("client")} /></Field>
          <Field label="Description" optional><Textarea {...f("description")} className="min-h-[80px]" /></Field>
          <Field label="Notes" optional><Textarea {...f("notes")} className="min-h-[70px]" /></Field>
        </div>
      </Drawer>
    </>
  );
}
