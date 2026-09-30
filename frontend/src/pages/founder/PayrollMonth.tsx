import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { CheckCircle2, Lock, Plus, Receipt, RefreshCw, Save, StickyNote, Trash2, TrendingDown, Undo2, Users, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { cn, inr } from "@/lib/format";
import type { PayrollMonth as PM, PayrollRow } from "@/lib/types";
import { AnimatedNumber, Badge, Button, Card, EmptyState, FileActions, PageHeader, PageSkeleton, Person, Select, Toggle } from "@/components/ui/core";
import { Modal, useConfirm } from "@/components/ui/overlay";

type Edit = Record<number, { basic: string; allowances: string; deductions: string; bonus: string; notes: string }>;
const AMT = ["basic", "allowances", "bonus", "deductions"] as const;
const n = (s: string | number | undefined) => { const v = parseFloat(String(s ?? "").replace(/,/g, "")); return Number.isFinite(v) ? v : 0; };

export default function PayrollMonth() {
  const { month } = useParams() as { month: string };
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ["payroll", month];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<PM>(`/payroll/${month}`) });
  const [edit, setEdit] = useState<Edit>({});
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [genSlips, setGenSlips] = useState(true);
  const [addId, setAddId] = useState("");
  const [notesOpen, setNotesOpen] = useState<number | null>(null);

  const seed = (d: PM) => {
    const e: Edit = {};
    d.rows.filter((r) => r.status === "draft").forEach((r) => { e[r.id] = { basic: String(r.basic), allowances: String(r.allowances), deductions: String(r.deductions), bonus: String(r.bonus), notes: r.notes ?? "" }; });
    setEdit(e);
  };
  useEffect(() => { if (data) seed(data); }, [data]);

  const onData = (d: PM) => { qc.setQueryData(key, d); qc.invalidateQueries({ queryKey: ["payroll"], exact: true }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const rowsPayload = () => Object.entries(edit).map(([id, v]) => ({ id: Number(id), basic: n(v.basic), allowances: n(v.allowances), deductions: n(v.deductions), bonus: n(v.bonus), notes: v.notes }));

  const save = useMutation({ mutationFn: () => api.put<PM>(`/payroll/${month}`, { rows: rowsPayload() }), onSuccess: (d) => { onData(d); toast.success("Draft saved"); } });
  const finalize = useMutation({
    mutationFn: async () => { await api.put<PM>(`/payroll/${month}`, { rows: rowsPayload() }); return api.post<PM>(`/payroll/${month}/finalize`, { generate_payslips: genSlips }); },
    onSuccess: (d) => { onData(d); setFinalizeOpen(false); qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(`Payroll finalised · ${inr(d.posted ?? 0)} posted to expenses${d.generated ? ` · ${d.generated} payslips generated` : ""}`); },
  });
  const addEmp = useMutation({ mutationFn: () => api.post<PM>(`/payroll/${month}/add`, { employee_id: Number(addId) }), onSuccess: (d) => { onData(d); setAddId(""); toast.success("Employee added"); } });
  const removeRow = useMutation({ mutationFn: (id: number) => api.del<PM>(`/payroll/rows/${id}`), onSuccess: (d) => { onData(d); toast.success("Removed from draft"); } });
  const slips = useMutation({ mutationFn: (regenerate: boolean) => api.post<PM>(`/payroll/${month}/payslips`, { regenerate }), onSuccess: (d) => { onData(d); toast.success(`${d.generated} payslip(s) ready`); } });
  const reopen = useMutation({
    mutationFn: () => api.post<PM & { message: string }>(`/payroll/${month}/reopen`),
    onSuccess: (d) => { onData(d); ["finance", "expenses", "payslips"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(d.message); },
  });
  const oneSlip = useMutation({ mutationFn: (id: number) => api.post<PM>(`/payroll/rows/${id}/payslip`), onSuccess: (d) => { onData(d); toast.success("Payslip generated"); } });

  const live = useMemo(() => {
    const t = { basic: 0, allowances: 0, deductions: 0, bonus: 0, net: 0 };
    const nets: Record<number, number> = {};
    (data?.rows ?? []).forEach((r) => {
      const v = edit[r.id];
      const get = (k: typeof AMT[number]) => (v ? n(v[k]) : r[k]);
      const net = get("basic") + get("allowances") + get("bonus") - get("deductions");
      nets[r.id] = net;
      AMT.forEach((k) => { t[k] += get(k); });
      t.net += net;
    });
    return { t, nets };
  }, [data, edit]);

  if (isLoading || !data) return <PageSkeleton />;
  const dirty = data.rows.some((r) => { const v = edit[r.id]; return v && (n(v.basic) !== r.basic || n(v.allowances) !== r.allowances || n(v.deductions) !== r.deductions || n(v.bonus) !== r.bonus || (v.notes || null) !== (r.notes || null)); });
  const draftTotal = data.rows.filter((r) => r.status === "draft").reduce((s, r) => s + (live.nets[r.id] ?? 0), 0);
  const setField = (id: number, k: keyof Edit[number], val: string) => {
    const clean = k === "notes" ? val : val.replace(/[^\d.]/g, "");
    setEdit((e) => ({ ...e, [id]: { ...e[id], [k]: clean } }));
  };

  return (
    <>
      <PageHeader back={{ to: "/payroll", label: "Payroll" }} eyebrow="Payroll month" title={data.label}
        subtitle={`${data.rows.length} employees · ${data.drafts} draft · ${data.finalized} finalised`}
        actions={data.finalized > 0 && (<>
          <Button icon={<Undo2 />} loading={reopen.isPending} onClick={async () => {
            const posted = data.expenses.reduce((s, x) => s + x.amount, 0);
            if (await confirm({ title: `Reopen ${data.label} payroll?`, danger: true, confirmText: "Reopen payroll",
              message: `The ${inr(posted)} salary expense and this month's payslips will be deleted, and every row goes back to draft so you can edit and finalise again.` })) reopen.mutate();
          }}>Reopen payroll</Button>
          {data.missing_payslips > 0
            ? <Button icon={<Receipt />} loading={slips.isPending} onClick={() => slips.mutate(false)}>Generate {data.missing_payslips} payslip{data.missing_payslips === 1 ? "" : "s"}</Button>
            : <Button icon={<RefreshCw />} loading={slips.isPending} onClick={() => slips.mutate(true)}>Regenerate payslips</Button>}
        </>)} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Net payable", value: live.t.net, icon: Wallet, accent: true },
          { label: "Gross earnings", value: live.t.basic + live.t.allowances + live.t.bonus, icon: Users },
          { label: "Deductions", value: live.t.deductions, icon: TrendingDown },
          { label: "Posted to expenses", value: data.expenses.reduce((s, x) => s + x.amount, 0), icon: CheckCircle2 },
        ].map((s) => (
          <Card key={s.label} glow={s.accent} className="p-5">
            <div className="flex items-center gap-2 text-[12.5px] text-fg-3"><s.icon className={cn("size-4", s.accent ? "text-brand-300" : "text-fg-4")} />{s.label}</div>
            <div className={cn("mt-2 font-display font-bold text-[22px]", s.accent && "text-grad")}><AnimatedNumber value={s.value} /></div>
          </Card>
        ))}
      </div>

      {data.drafts > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-500/25 bg-brand-500/[0.07] px-5 py-3.5 mb-5 text-[13.5px]">
          <StickyNote className="size-4 text-brand-300 shrink-0" />
          <span className="text-fg-2">Draft rows are editable. <b className="text-fg">Finalise</b> locks them, posts one <i>Salary</i> expense and generates payslips.</span>
        </div>
      )}

      <Card className="overflow-hidden">
        {data.rows.length === 0 ? <EmptyState icon={<Users />} title="No employees in this payroll" text="Add employees below." /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Employee</th><th className="text-right">Basic</th><th className="text-right">Allowances</th><th className="text-right">Bonus</th><th className="text-right">Deductions</th><th className="text-right">Net salary</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.rows.map((r: PayrollRow) => {
                  const v = edit[r.id];
                  const draft = r.status === "draft" && v;
                  return (
                    <tr key={r.id} className={cn(draft && "bg-white/[0.01]")}>
                      <td className="min-w-[220px]"><Person e={r.employee} to={`/employees/${r.employee.id}`} sub={r.notes ? <span className="text-brand-300/80">{r.notes}</span> : r.employee.emp_code} size={34} /></td>
                      {AMT.map((k) => (
                        <td key={k} className="text-right">
                          {draft ? (
                            <input value={v[k]} inputMode="decimal" onChange={(e) => setField(r.id, k, e.target.value)} aria-label={`${k} for ${r.employee.full_name}`}
                              className={cn("input input-sm w-[112px] text-right tnum", k === "deductions" && n(v[k]) > 0 && "text-rose-300", (k === "bonus" || k === "allowances") && n(v[k]) > 0 && "text-emerald-300")} />
                          ) : <span className="tnum text-fg-2">{inr(r[k])}</span>}
                        </td>
                      ))}
                      <td className="text-right"><motion.span key={live.nets[r.id]} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="tnum font-semibold text-[14.5px]">{inr(live.nets[r.id])}</motion.span></td>
                      <td>{r.status === "finalized" ? <Badge tone="good" dot>Finalised</Badge> : <Badge tone="warn" dot>Draft</Badge>}</td>
                      <td>
                        <div className="flex justify-end items-center gap-1">
                          {draft ? (<>
                            <Button size="sm" variant="ghost" iconOnly icon={<StickyNote />} title="Payslip note" onClick={() => setNotesOpen(r.id)} className={cn(v.notes && "text-brand-300")} />
                            <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Remove" onClick={async () => { if (await confirm({ title: `Remove ${r.employee.full_name}?`, message: "They'll be removed from this month's draft.", confirmText: "Remove", danger: true })) removeRow.mutate(r.id); }} />
                          </>) : r.payslip ? <FileActions url={r.payslip.file_url} /> : <Button size="xs" icon={<Receipt />} loading={oneSlip.isPending && oneSlip.variables === r.id} onClick={() => oneSlip.mutate(r.id)}>Payslip</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <td className="text-fg-3">Total</td>
                {AMT.map((k) => <td key={k} className="text-right tnum">{inr(live.t[k])}</td>)}
                <td className="text-right tnum text-[15px]"><span className="text-grad">{inr(live.t.net)}</span></td><td colSpan={2} />
              </tr></tfoot>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-t divider bg-white/[0.015]">
          {data.addable.length > 0 && (
            <div className="flex items-center gap-2">
              <Select className="input-sm h-[34px] w-[240px]" value={addId} onChange={(e) => setAddId(e.target.value)} placeholder="Add employee to this month…"
                options={data.addable.map((e) => ({ value: String(e.id), label: `${e.full_name}${e.status !== "active" ? " (inactive)" : ""}` }))} />
              <Button size="sm" icon={<Plus />} disabled={!addId} loading={addEmp.isPending} onClick={() => addEmp.mutate()}>Add</Button>
            </div>
          )}
          <div className="flex-1" />
          {data.drafts > 0 && (<>
            <Button icon={<Save />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save draft</Button>
            <Button variant="primary" icon={<Lock />} onClick={() => setFinalizeOpen(true)}>Finalise payroll</Button>
          </>)}
        </div>
      </Card>

      <AnimatePresence>
        {dirty && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 lg:ml-[132px] z-40 flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-800/95 backdrop-blur-xl px-4 py-3 shadow-2xl">
            <span className="size-2 rounded-full bg-warn animate-pulse" /><span className="text-[13px] text-fg-2">Unsaved changes</span>
            <Button size="sm" variant="ghost" onClick={() => seed(data)}>Discard</Button>
            <Button size="sm" variant="primary" icon={<Save />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={finalizeOpen} onClose={() => setFinalizeOpen(false)} title={`Finalise ${data.label}?`} subtitle="Draft rows will be locked. Use Reopen payroll later if you need to correct it."
        footer={<><Button variant="ghost" onClick={() => setFinalizeOpen(false)}>Cancel</Button><Button variant="primary" icon={<Lock />} loading={finalize.isPending} onClick={() => finalize.mutate()}>Finalise & post</Button></>}>
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-brand-500/10 to-flame-500/5 p-5 text-center">
          <div className="text-[12.5px] text-fg-3">Will be posted to expenses as <b className="text-fg">Salary</b></div>
          <div className="font-display text-[32px] font-bold mt-1 text-grad tnum">{inr(draftTotal)}</div>
          <div className="text-[12.5px] text-fg-4 mt-1">{data.drafts} employee{data.drafts === 1 ? "" : "s"}</div>
        </div>
        <div className="mt-5"><Toggle checked={genSlips} onChange={setGenSlips} label="Generate payslips now" /></div>
      </Modal>

      <Modal open={notesOpen !== null} onClose={() => setNotesOpen(null)} title="Payslip note" subtitle="Printed on this employee's payslip, e.g. “Festival bonus” or “1 day LOP”."
        footer={<Button variant="primary" onClick={() => setNotesOpen(null)}>Done</Button>}>
        {notesOpen !== null && edit[notesOpen] && (
          <input autoFocus className="input" value={edit[notesOpen].notes} maxLength={255} onChange={(e) => setField(notesOpen, "notes", e.target.value)} placeholder="Optional note" />
        )}
      </Modal>
    </>
  );
}
