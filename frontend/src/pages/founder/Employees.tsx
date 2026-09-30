import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Building2, CalendarDays, Layers, LayoutGrid, List, Network, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";
import { PutUnderModal } from "@/components/ReportsModals";
import { useSession } from "@/lib/session";
import { useConfirm } from "@/components/ui/overlay";
import { api, qs } from "@/lib/api";
import { cn, fmtDate, inr } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { EmployeeBrief } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, SearchInput, Segmented, Skeleton, StatusBadge } from "@/components/ui/core";
import { EMPLOYMENT_META } from "@/components/EmploymentTypePicker";

type Status = "active" | "inactive" | "all";
interface ListData {
  employees: EmployeeBrief[]; counts: Record<Status, number>;
  by_type: { type: string; count: number }[]; by_role: { role: string; count: number }[]; multi_role: number;
}

export function RoleChips({ roles, max = 2 }: { roles: string[]; max?: number }) {
  if (!roles?.length) return <span className="text-fg-4">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {roles.slice(0, max).map((r, i) => (
        <span key={r} className={cn("inline-flex h-6 items-center rounded-md px-2 text-[11.5px] font-medium border", i === 0 ? "border-brand-500/30 bg-brand-500/10 text-brand-300" : "border-white/10 bg-white/[0.04] text-fg-2")}>{r}</span>
      ))}
      {roles.length > max && <span className="text-[11.5px] text-fg-4" title={roles.slice(max).join(", ")}>+{roles.length - max}</span>}
    </span>
  );
}

export default function Employees() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { user } = useSession();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [putUnder, setPutUnder] = useState(false);
  const [status, setStatus] = useState<Status>("active");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [role, setRole] = useState("");
  const [view, setView] = useState<"table" | "grid">(() => { try { return (localStorage.getItem("cl.emp.view") as "table" | "grid") || "table"; } catch { return "table"; } });
  const dq = useDebounced(q);
  const { data, isLoading } = useQuery({
    queryKey: ["employees", status, dq, type, role],
    queryFn: () => api.get<ListData>(`/employees${qs({ status, q: dq, type, role })}`),
    placeholderData: keepPreviousData,
  });
  const setViewPersist = (v: "table" | "grid") => { setView(v); try { localStorage.setItem("cl.emp.view", v); } catch { /* ignore */ } };
  const rows = data?.employees ?? [];
  const totalActive = data?.counts.active ?? 0;
  const myId = user?.employee?.id;

  const remove = useMutation({
    mutationFn: async (targets: EmployeeBrief[]) => {
      for (const t of targets) await api.del(`/employees/${t.id}`, { confirm_code: t.emp_code });
      return targets.length;
    },
    onSuccess: (n) => {
      setSelected(new Set());
      ["employees", "employee-options", "dashboard", "org"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`${n} employee${n === 1 ? "" : "s"} deleted`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
  const askDelete = async (targets: EmployeeBrief[]) => {
    if (!targets.length) return;
    const one = targets.length === 1;
    const ok = await confirm({
      title: one ? `Delete ${targets[0].full_name}?` : `Delete ${targets.length} employees?`, danger: true, confirmText: "Delete forever",
      requireText: one ? targets[0].emp_code : "DELETE",
      message: <>Are you sure you want to delete {one ? "this employee" : "these employees"}? This permanently removes {one ? "their" : "each person's"} login, letters, payslips and uploads. Posted payroll expenses stay in Finance.
        {!one && <span className="block mt-2 text-fg-3">{targets.map((t) => t.full_name).join(", ")}</span>}
        <span className="block mt-2 text-fg-3">Prefer <b>Deactivate</b> or a <b>relieving letter</b> if someone is simply leaving.</span></>,
    });
    if (ok) remove.mutate(targets);
  };
  const toggleSel = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectable = rows.filter((r) => r.id !== myId);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  return (
    <>
      <PageHeader eyebrow="People" title="Employees"
        subtitle={data ? `${data.counts.active} active · ${data.counts.inactive} inactive · ${data.multi_role} with multiple roles` : "Your team"}
        actions={<Button variant="primary" icon={<UserPlus />} to="/employees/new">Add employee</Button>} />

      {data && totalActive > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4 mb-6">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold"><Layers className="size-4 text-brand-300" /> By employment type</div>
              {type && <button onClick={() => setType("")} className="text-[12px] text-fg-3 hover:text-fg flex items-center gap-1"><X className="size-3" /> Clear</button>}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {data.by_type.map((t) => {
                const m = EMPLOYMENT_META[t.type] ?? EMPLOYMENT_META["Full-time"];
                const on = type === t.type;
                return (
                  <button key={t.type} onClick={() => setType(on ? "" : t.type)} disabled={!t.count}
                    className={cn("rounded-xl border p-3 text-left transition-all disabled:opacity-40", on ? "border-brand-400/60 bg-brand-500/10" : "border-white/[0.07] bg-white/[0.02] hover:border-white/20")}>
                    <m.icon className={cn("size-4", m.tone)} />
                    <div className="font-display font-bold text-[20px] mt-2 tnum">{t.count}</div>
                    <div className="text-[11.5px] text-fg-3 truncate">{t.type}</div>
                    <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden"><motion.div className="h-full rounded-full" style={{ background: "var(--grad)" }} initial={{ width: 0 }} animate={{ width: `${(t.count / totalActive) * 100}%` }} /></div>
                  </button>
                );
              })}
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold"><Users className="size-4 text-flame-400" /> Roles across the team</div>
              {role && <button onClick={() => setRole("")} className="text-[12px] text-fg-3 hover:text-fg flex items-center gap-1"><X className="size-3" /> Clear</button>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.by_role.slice(0, 16).map((r) => (
                <button key={r.role} onClick={() => setRole(role === r.role ? "" : r.role)}
                  className={cn("inline-flex items-center gap-1.5 h-7 rounded-lg border px-2.5 text-[12px] transition-all", role === r.role ? "border-brand-400/60 bg-brand-500/15 text-fg" : "border-white/[0.08] text-fg-2 hover:border-white/20")}>
                  {r.role}<span className="text-fg-4 tnum">{r.count}</span>
                </button>
              ))}
              {!data.by_role.length && <span className="text-[12.5px] text-fg-4">No roles yet.</span>}
            </div>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Segmented layoutId="emp-status" value={status} onChange={setStatus} options={[
          { value: "active", label: "Active", count: data?.counts.active },
          { value: "inactive", label: "Inactive", count: data?.counts.inactive },
          { value: "all", label: "All", count: data?.counts.all },
        ]} />
        {(type || role) && <Badge tone="brand">{[type, role].filter(Boolean).join(" · ")}</Badge>}
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search name, ID, role, email…" className="w-full sm:w-[300px]" />
        <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
          {([["table", List], ["grid", LayoutGrid]] as const).map(([v, Icon]) => (
            <button key={v} onClick={() => setViewPersist(v)} aria-label={`${v} view`}
              className={cn("grid place-items-center size-[30px] rounded-lg transition-colors", view === v ? "bg-white/10 text-fg" : "text-fg-4 hover:text-fg")}><Icon className="size-4" /></button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 lg:ml-[132px] z-40 flex items-center gap-3 rounded-2xl border border-white/10 panel backdrop-blur-xl px-4 py-3 shadow-2xl">
            <span className="text-[13px] font-medium">{selected.size} selected</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" icon={<Network />} onClick={() => setPutUnder(true)}>Put under…</Button>
            <Button size="sm" variant="danger" icon={<Trash2 />} loading={remove.isPending} onClick={() => askDelete(rows.filter((r) => selected.has(r.id)))}>Delete selected</Button>
          </motion.div>
        )}
      </AnimatePresence>
      <PutUnderModal people={rows.filter((r) => selected.has(r.id))} open={putUnder}
        onClose={(done) => { setPutUnder(false); if (done) setSelected(new Set()); }} />

      {isLoading ? (
        <Card className="p-6 space-y-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</Card>
      ) : rows.length === 0 ? (
        <Card>
          {q || type || role ? <EmptyState icon={<Users />} title="No matches" text="No employee matches these filters." />
            : <EmptyState icon={<Users />} title="No employees here yet" text="Add your first team member to start generating letters and payslips."
              action={<Button variant="primary" icon={<UserPlus />} to="/employees/new">Add employee</Button>} />}
        </Card>
      ) : view === "table" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr>
                <th className="w-10"><input type="checkbox" aria-label="Select all" className="size-4 accent-[#7c5cff] cursor-pointer" checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))} /></th>
                <th>Employee</th><th>Roles</th><th>Type</th><th>Department</th><th>Joined</th><th className="text-right">Monthly pay</th><th>Status</th><th />
              </tr></thead>
              <tbody>
                {rows.map((e, i) => (
                  <motion.tr key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }} onClick={() => navigate(`/employees/${e.id}`)}
                    className={cn("cursor-pointer group", selected.has(e.id) && "bg-brand-500/[0.06]")}>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      {e.id !== myId && <input type="checkbox" aria-label={`Select ${e.full_name}`} className="size-4 accent-[#7c5cff] cursor-pointer" checked={selected.has(e.id)} onChange={() => toggleSel(e.id)} />}
                    </td>
                    <td>
                      <div className="flex items-center gap-3 min-w-[200px]">
                        <Avatar person={e} size={38} />
                        <div className="min-w-0">
                          <div className="font-medium flex items-center gap-1.5">{e.full_name}{e.is_admin && <ShieldCheck className="size-3.5 text-brand-300" aria-label="Admin" />}</div>
                          <div className="text-[12px] text-fg-4 font-mono">{e.emp_code}</div>
                        </div>
                      </div>
                    </td>
                    <td><RoleChips roles={e.roles} /></td>
                    <td className="text-fg-2 whitespace-nowrap">{e.employment_type ?? "—"}</td>
                    <td className="text-fg-2">{e.department ?? "—"}</td>
                    <td className="text-fg-3 whitespace-nowrap">{fmtDate(e.joining_date)}</td>
                    <td className="text-right tnum font-medium">{inr(e.monthly_salary)}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td onClick={(ev) => ev.stopPropagation()} className="text-right">
                      {e.id !== myId && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title={`Delete ${e.full_name}`} className="opacity-50 group-hover:opacity-100 hover:!text-bad" onClick={() => askDelete([e])} />}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {rows.map((e, i) => (
            <motion.div key={e.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Link to={`/employees/${e.id}`}>
                <Card hover className="group relative overflow-hidden p-5 h-full">
                  <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-br from-brand-500/20 via-flame-500/5 to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />
                  <div className="relative flex items-start justify-between">
                    <Avatar person={e} size={56} ring />
                    <div className="flex flex-col items-end gap-1.5"><StatusBadge status={e.status} />{e.is_admin && <Badge tone="brand"><ShieldCheck className="size-3" /> Admin</Badge>}</div>
                  </div>
                  <div className="relative mt-4 font-display font-semibold text-[16px] truncate">{e.full_name}</div>
                  <div className="relative mt-1.5"><RoleChips roles={e.roles} max={3} /></div>
                  <div className="relative mt-4 space-y-1.5 text-[12.5px] text-fg-3">
                    <div className="flex items-center gap-2"><Building2 className="size-3.5" />{e.department ?? "—"} · {e.employment_type}</div>
                    <div className="flex items-center gap-2"><CalendarDays className="size-3.5" />Joined {fmtDate(e.joining_date)}</div>
                  </div>
                  <div className="relative mt-4 pt-4 border-t divider flex items-center justify-between">
                    <span className="font-mono text-[11.5px] text-fg-4">{e.emp_code}</span>
                    <span className="tnum font-semibold">{inr(e.monthly_salary)}<span className="text-fg-4 font-normal text-[12px]">/mo</span></span>
                  </div>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </>
  );
}
