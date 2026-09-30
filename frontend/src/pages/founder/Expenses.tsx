import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownRight, Check, Lock, Paperclip, Pencil, Plus, Trash2, TrendingDown, Wallet } from "lucide-react";
import { api, qs, toForm } from "@/lib/api";
import { cn, fmtDate, inr, today } from "@/lib/format";
import { useDebounced, useMeta } from "@/lib/hooks";
import { can, useSession } from "@/lib/session";
import type { Expense, Period } from "@/lib/types";
import { AnimatedNumber, Badge, Button, Card, EmptyState, Field, Input, MoneyInput, PageHeader, SearchInput, Select, Skeleton, Textarea, Toggle } from "@/components/ui/core";
import { Drawer, FileDrop, useConfirm } from "@/components/ui/overlay";
import { PeriodPicker, type PeriodKey, type PeriodValue } from "@/components/PeriodPicker";
import { CATEGORY_COLORS } from "@/components/charts";

const EMPTY = { date: today(), category: "Server/Hosting", description: "", amount: "", paid_by: "", payment_method: "", notes: "" };

export default function ExpensesPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const meta = useMeta();
  const { user } = useSession();
  const [p, setP] = useState<PeriodValue>({ period: (params.get("period") as PeriodKey) || "all", start: params.get("start") ?? "", end: params.get("end") ?? "" });
  const [q, setQ] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const dq = useDebounced(q);

  useEffect(() => { if (params.get("new")) { setEditing("new"); params.delete("new"); setParams(params, { replace: true }); } }, [params, setParams]);
  useEffect(() => {
    setReceipt(null); setRemoveReceipt(false);
    if (editing === "new") setForm({ ...EMPTY, date: today() });
    else if (editing) setForm({ date: editing.date, category: editing.category, description: editing.description, amount: String(editing.amount), paid_by: editing.paid_by ?? "", payment_method: editing.payment_method ?? "", notes: editing.notes ?? "" });
  }, [editing]);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", p, dq, category],
    queryFn: () => api.get<{ rows: Expense[]; period: Period; total: number; payroll: number; other: number }>(`/expenses${qs({ ...(p.period === "custom" ? p : { period: p.period }), q: dq, category })}`),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => { ["expenses", "finance", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const save = useMutation({
    mutationFn: () => {
      const fd = toForm({ ...form, remove_receipt: removeReceipt }, { receipt });
      return editing && editing !== "new" ? api.put<{ row: Expense }>(`/expenses/${editing.id}`, fd) : api.post<{ row: Expense }>("/expenses", fd);
    },
    onSuccess: (r) => { invalidate(); setEditing(null); toast.success(`Expense ${r.row.code} saved`); },
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/expenses/${id}`), onSuccess: () => { invalidate(); toast.success("Expense deleted"); } });
  // Payroll expenses are removed by reopening their payroll month, which also clears its payslips.
  const reopen = useMutation({
    mutationFn: (month: string) => api.post<{ message: string }>(`/payroll/${month}/reopen`),
    onSuccess: (r) => { invalidate(); ["payroll", "payslips"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(r.message); },
  });
  const f = (k: keyof typeof EMPTY) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value }) });
  const catColor = (c: string) => CATEGORY_COLORS[Math.max(0, meta.expense_categories.indexOf(c)) % CATEGORY_COLORS.length];

  return (
    <>
      <PageHeader eyebrow="Finance" title="Expenses" subtitle={data ? `${data.period.label} · ${data.rows.length} entries` : "Money going out"}
        actions={<Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Add expense</Button>} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <Card glow className="p-5"><div className="flex items-center gap-2 text-[12.5px] text-fg-3"><ArrowDownRight className="size-4 text-bad" />Total expenses</div><div className="font-display font-bold text-[26px] mt-1 text-bad"><AnimatedNumber value={data?.total ?? 0} /></div><div className="text-[12px] text-fg-4">{category || "All categories"}</div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 text-[12.5px] text-fg-3"><Wallet className="size-4 text-flame-400" />Payroll</div><div className="font-display font-bold text-[26px] mt-1"><AnimatedNumber value={data?.payroll ?? 0} /></div><div className="text-[12px] text-fg-4">Posted by finalised payroll</div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 text-[12.5px] text-fg-3"><TrendingDown className="size-4 text-brand-300" />Other expenses</div><div className="font-display font-bold text-[26px] mt-1"><AnimatedNumber value={data?.other ?? 0} /></div><div className="text-[12px] text-fg-4">Hosting, software, office…</div></Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <PeriodPicker value={p} onChange={setP} />
        <Select className="input-sm h-[38px] w-[170px]" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All categories" options={meta.expense_categories} />
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search description, paid by…" className="w-full sm:w-[260px]" />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : !data?.rows.length ? <EmptyState icon={<TrendingDown />} title="No expenses recorded" text="Track hosting, software and office costs. Finalised payroll is added automatically." action={<Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Add expense</Button>} />
          : (
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>ID</th><th>Date</th><th>Category</th><th>Description</th><th>Paid by</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id} className="group">
                  <td className="font-mono text-[12px] text-fg-4">{r.code}</td>
                  <td className="text-fg-3 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td><span className="inline-flex items-center gap-2 text-[13px]"><span className="size-2 rounded-full" style={{ background: catColor(r.category), boxShadow: `0 0 8px ${catColor(r.category)}` }} />{r.category}</span></td>
                  <td>
                    <div className="font-medium">{r.description}</div>
                    {r.is_payroll && <Link to={`/payroll/${r.payroll_month}`} className="text-[12px] text-brand-300 hover:underline">From payroll →</Link>}
                  </td>
                  <td className="text-fg-2">{r.paid_by ?? "—"}{r.payment_method && <div className="text-[12px] text-fg-4">{r.payment_method}</div>}</td>
                  <td className="text-right tnum font-semibold">{inr(r.amount)}</td>
                  <td><div className="flex justify-end items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {r.receipt_url && <Button size="sm" variant="ghost" iconOnly icon={<Paperclip />} href={r.receipt_url} title="Receipt" />}
                    {r.is_payroll ? (<>
                      <Badge tone="brand"><Lock className="size-3" /> Payroll</Badge>
                      {can(user, "payroll") && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete (reopens this payroll month)" loading={reopen.isPending}
                        onClick={async () => {
                          if (await confirm({
                            title: `Delete ${r.code}?`, danger: true, confirmText: "Delete & reopen payroll",
                            message: `This salary expense (${inr(r.amount)}) was posted when ${r.description.replace(/^Payroll — /, "").replace(/ \(.*\)$/, "")} payroll was finalised. Deleting it reopens that payroll as a draft and removes its payslips, so payroll and the balance stay in step. You can edit and finalise it again afterwards.`,
                          })) reopen.mutate(r.payroll_month!);
                        }} />}
                    </>) : (<>
                      <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} title="Edit" onClick={() => setEditing(r)} />
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete" onClick={async () => { if (await confirm({ title: `Delete ${r.code}?`, message: `${r.description} · ${inr(r.amount)}`, danger: true, confirmText: "Delete" })) del.mutate(r.id); }} />
                    </>)}
                  </div></td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5} className="text-fg-3">Total</td><td className="text-right tnum">{inr(data.total)}</td><td /></tr></tfoot>
            </table></div>
          )}
      </Card>

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? `Edit ${editing.code}` : "Add expense"}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" icon={<Check />} loading={save.isPending} onClick={() => save.mutate()}>Save expense</Button></>}>
        <div className="space-y-5">
          <Field label="Amount"><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} className="h-14 text-[22px] font-display font-semibold" autoFocus placeholder="0" /></Field>
          <Field label="Category">
            <div className="flex flex-wrap gap-2">
              {meta.expense_categories.filter((c) => c !== "Salary").concat("Salary").map((c) => (
                <button key={c} type="button" onClick={() => setForm({ ...form, category: c })}
                  className={cn("inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[12.5px] transition-all", form.category === c ? "border-white/25 bg-white/10 text-fg" : "border-white/[0.08] text-fg-3 hover:text-fg hover:border-white/15")}>
                  <span className="size-2 rounded-full" style={{ background: catColor(c) }} />{c}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Description"><Input {...f("description")} placeholder="e.g. AWS hosting — September" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date"><Input type="date" {...f("date")} /></Field>
            <Field label="Payment method"><Select {...f("payment_method")} placeholder="—" options={meta.payment_methods} /></Field>
          </div>
          <Field label="Paid by" optional><Input {...f("paid_by")} placeholder="e.g. Company / Founder" /></Field>
          <Field label="Receipt" optional>
            {editing && editing !== "new" && editing.receipt_url && !receipt && (
              <div className="flex items-center gap-3 mb-3 text-[13px]">
                <a href={editing.receipt_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-brand-300 hover:underline"><Paperclip className="size-3.5" />{editing.receipt_name ?? "Current receipt"}</a>
                <Toggle checked={removeReceipt} onChange={setRemoveReceipt} label="Remove" />
              </div>
            )}
            <FileDrop file={receipt} onFile={setReceipt} accept=".pdf,.png,.jpg,.jpeg,.webp" label="Attach receipt" hint="PDF or image · max 15 MB" />
          </Field>
          <Field label="Notes" optional><Textarea {...f("notes")} className="min-h-[70px]" /></Field>
        </div>
      </Drawer>
    </>
  );
}
