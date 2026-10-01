import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, BookOpen, BriefcaseBusiness, DoorOpen, Building2, CalendarDays, Copy, EyeOff, Eye, FileText, KeyRound, ListTodo,
  GraduationCap, Landmark, ListChecks, Mail, MapPin, Network, Pencil, Phone, Plus, Power, Receipt, Send, ShieldCheck, Trash2, Upload, UserPlus, UserRound, Wallet, X } from "lucide-react";
import { api, toForm } from "@/lib/api";
import { cn, fmtDate, fmtDateTime, inr, monthLabel } from "@/lib/format";
import type { Area, AreaInfo, EmployeeProfile as Profile, Leave, Task } from "@/lib/types";
import { can, useSession } from "@/lib/session";
import { RoleChips } from "./Employees";
import { LeaveStatusBadge } from "@/pages/Leaves";
import { PriorityBadge, TaskStatusBadge } from "@/pages/Tasks";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageSkeleton, StatusBadge, Toggle } from "@/components/ui/core";
import { FileDrop, Modal, useConfirm } from "@/components/ui/overlay";
import { DocRow } from "@/components/DocRow";
import { AddReportsModal, useRemoveReport } from "@/components/ReportsModals";
import { TaskDetailDrawer } from "@/components/TaskDetailDrawer";

type Tab = "overview" | "team" | "documents" | "payroll" | "leaves" | "tasks" | "access";

export default function EmployeeProfile() {
  const { id } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("overview");
  const [upload, setUpload] = useState(false);
  const [tempPw, setTempPw] = useState<{ email: string; password: string } | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["employee", id], queryFn: () => api.get<{ employee: Profile }>(`/employees/${id}`) });

  const refresh = (e?: Profile) => {
    if (e) qc.setQueryData(["employee", id], { employee: e });
    else qc.invalidateQueries({ queryKey: ["employee", id] });
    qc.invalidateQueries({ queryKey: ["employees"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const toggle = useMutation({
    mutationFn: () => api.post<{ employee: Profile; message: string }>(`/employees/${id}/toggle-status`),
    onSuccess: (r) => { refresh(r.employee); toast.success(r.message); },
  });
  const remove = useMutation({
    mutationFn: (code: string) => api.del(`/employees/${id}`, { confirm_code: code }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Employee deleted"); navigate("/employees"); },
  });
  const docAction = useMutation({
    mutationFn: ({ docId, action }: { docId: number; action: string }) => api.post(`/employee-documents/${docId}/${action}`),
    onSuccess: () => refresh(),
  });

  if (isLoading || !data) return <PageSkeleton />;
  const e = data.employee;

  const askDelete = async () => {
    const code = await confirm({ title: `Delete ${e.full_name}?`, danger: true, requireText: e.emp_code, confirmText: "Delete forever",
      message: "Are you sure you want to delete this employee? This permanently removes the employee, their login, letters, payslips and uploads. Posted payroll expenses stay in Finance. Prefer Deactivate (or a relieving letter) if they are simply leaving." });
    if (code) remove.mutate(code);
  };
  const isSelf = user?.employee?.id === e.id;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "team", label: "Team", count: e.reports?.length ?? 0 },
    { id: "documents", label: "Documents", count: e.offer_letters.length + e.joining_letters.length + (e.relieving_letters?.length ?? 0) + e.payslips.length + e.documents.length },
    { id: "payroll", label: "Payroll", count: e.payroll.length },
    ...(can(user, "leaves") ? [{ id: "leaves" as Tab, label: "Leaves" }] : []),
    ...(can(user, "team") ? [{ id: "tasks" as Tab, label: "Tasks" }] : []),
    { id: "access", label: "Access & manage" },
  ];

  return (
    <>
      <Link to="/employees" className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 hover:text-fg mb-4">← Employees</Link>

      {/* hero */}
      <Card className="relative overflow-hidden">
        <div className="relative h-32 sm:h-36 overflow-hidden">
          <div className="absolute inset-0" style={{ background: "linear-gradient(120deg, rgba(124,92,255,0.55), rgba(179,92,255,0.25) 45%, rgba(255,122,69,0.35))" }} />
          <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.25) 1px, transparent 1px)", backgroundSize: "18px 18px" }} />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-900/80 to-transparent" />
        </div>
        <div className="relative px-6 sm:px-8 pb-6 -mt-12 flex flex-wrap items-end gap-5">
          <div className="rounded-full p-1 bg-ink-900"><Avatar person={e} size={96} /></div>
          <div className="flex-1 min-w-[220px] pb-1">
            <h1 className="font-display text-[26px] font-bold leading-tight">{e.full_name}</h1>
            <div className="mt-1.5"><RoleChips roles={e.roles} max={6} /></div>
            <div className="text-fg-3 mt-1.5 text-[13px]">{e.department ?? "No department"}{e.work_location && ` · ${e.work_location}`}</div>
            <div className="flex flex-wrap gap-2 mt-3">
              <StatusBadge status={e.status} />
              <Badge>{e.employment_type ?? "—"}{e.end_date && ` · until ${fmtDate(e.end_date)}`}</Badge>
              {e.is_admin && <Badge tone="brand"><ShieldCheck className="size-3" /> Admin access</Badge>}
              {e.login?.active && e.status === "active" && <Badge tone="info"><ShieldCheck className="size-3" /> Portal access</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pb-1">
            <Button icon={<Pencil />} to={`/employees/${e.id}/edit`}>Edit</Button>
            <Button icon={<Send />} to={`/letters/offer/new?employee=${e.id}`}>Offer letter</Button>
            <Button variant="primary" icon={<BriefcaseBusiness />} to={`/letters/joining/new?employee=${e.id}`}>Joining letter</Button>
            <Button icon={<DoorOpen />} to={`/letters/relieving/new?employee=${e.id}`}>Relieving letter</Button>
            {!isSelf && <Button variant="danger" iconOnly icon={<Trash2 />} title="Delete employee" loading={remove.isPending} onClick={askDelete} />}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 border-t divider">
          {[
            ["Employee ID", <span className="font-mono">{e.emp_code}</span>],
            ["Joined", fmtDate(e.joining_date)],
            ["Monthly salary", <span className="tnum">{inr(e.monthly_salary)}</span>],
            ["Reports to", e.manager ? <Link to={`/employees/${e.manager.id}`} className="hover:text-brand-300">{e.manager.full_name}</Link> : (e.reporting_person ?? "Founder")],
          ].map(([k, v], i) => (
            <div key={i} className={cn("px-6 sm:px-8 py-4", i < 3 && "md:border-r divider", i < 2 && "border-b md:border-b-0", i === 0 && "border-r")}>
              <div className="text-[12px] text-fg-4">{k}</div>
              <div className="font-semibold mt-0.5 truncate">{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* tabs */}
      <div className="flex gap-1 mt-7 mb-5 border-b divider overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn("relative px-4 pb-3 pt-1 text-[13.5px] font-medium whitespace-nowrap transition-colors", tab === t.id ? "text-fg" : "text-fg-3 hover:text-fg")}>
            {t.label}{t.count !== undefined && <span className="ml-1.5 text-[11.5px] text-fg-4">{t.count}</span>}
            {tab === t.id && <motion.span layoutId="profile-tab" className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full" style={{ background: "var(--grad)" }} />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}>
          {tab === "overview" && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <Card>
                <CardHeader icon={<UserRound />} title="Personal" />
                <Info rows={[[<Phone />, "Phone", e.phone], [<Mail />, "Email", e.email], [<CalendarDays />, "Date of birth", fmtDate(e.date_of_birth)], [<MapPin />, "Address", e.address]]} />
              </Card>
              <Card>
                <CardHeader icon={<BriefcaseBusiness />} title="Job" />
                <Info rows={[[<Building2 />, "Department", e.department], [<MapPin />, "Work location", e.work_location], [<UserRound />, "Reports to", e.reporting_person], [<CalendarDays />, "Salary effective", fmtDate(e.salary_effective_date)]]} />
              </Card>
              <Card>
                <CardHeader icon={e.college || e.study_department ? <GraduationCap /> : <FileText />} title={e.college || e.study_department ? "Education" : "Experience"} />
                <Info rows={[
                  ...(e.college || e.study_department
                    ? [[<GraduationCap />, "College", e.college], [<BookOpen />, "Department / course", e.study_department]] as [ReactNode, string, ReactNode][]
                    : [[<BriefcaseBusiness />, "Experience", e.experience_level === "experienced" ? `Experienced${e.experience_years ? ` · ${e.experience_years} yr${e.experience_years === 1 ? "" : "s"}` : ""}` : e.experience_level === "fresher" ? "Fresher" : null],
                       ...(e.previous_company ? [[<Building2 />, "Previous company", e.previous_company]] : [])] as [ReactNode, string, ReactNode][]),
                  [<FileText />, "Resume", e.resume_url ? <a href={e.resume_url} target="_blank" rel="noopener noreferrer" className="text-brand-300 hover:underline">{e.resume_name ?? "View resume"}</a> : null],
                ]} />
              </Card>
              <Card>
                <CardHeader icon={<Landmark />} title="Bank" />
                <Info rows={[[<Landmark />, "Bank", e.bank_name], [<UserRound />, "Account holder", e.bank_account_name], [<Wallet />, "Account no.", e.bank_account_number && <span className="font-mono">{e.bank_account_number}</span>], [<FileText />, "IFSC", e.bank_ifsc && <span className="font-mono">{e.bank_ifsc}</span>]]} />
              </Card>
            </div>
          )}

          {tab === "documents" && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <DocGroup title="Offer letter" icon={<Send />} action={<Button size="sm" icon={<Plus />} to={`/letters/offer/new?employee=${e.id}`}>Create</Button>}
                empty="No offer letter yet.">
                {e.offer_letters.map((l, i) => <DocRow key={l.id} index={i} kind="offer" title={l.number} sub={`Issued ${fmtDate(l.letter_date)}`} url={l.file_url}
                  badge={l.archived && <Badge>Archived</Badge>} extra={<Button size="sm" variant="ghost" iconOnly icon={<Pencil />} to={`/letters/offer/${l.id}`} title="Edit & regenerate" />} />)}
              </DocGroup>
              <DocGroup title="Joining letter" icon={<BriefcaseBusiness />} action={<Button size="sm" icon={<Plus />} to={`/letters/joining/new?employee=${e.id}`}>Create</Button>}
                empty="No joining letter yet.">
                {e.joining_letters.map((l, i) => <DocRow key={l.id} index={i} kind="joining" title={l.number} sub={`Issued ${fmtDate(l.letter_date)}`} url={l.file_url}
                  badge={l.archived && <Badge>Archived</Badge>} extra={<Button size="sm" variant="ghost" iconOnly icon={<Pencil />} to={`/letters/joining/${l.id}`} title="Edit & regenerate" />} />)}
              </DocGroup>
              <DocGroup title="Relieving letter" icon={<DoorOpen />} action={<Button size="sm" icon={<Plus />} to={`/letters/relieving/new?employee=${e.id}`}>Create</Button>}
                empty="Issued when the employee leaves.">
                {(e.relieving_letters ?? []).map((l, i) => <DocRow key={l.id} index={i} kind="relieving" title={l.number} sub={`Last working day ${fmtDate(l.last_working_day)}`} url={l.file_url}
                  badge={l.archived && <Badge>Archived</Badge>} extra={<Button size="sm" variant="ghost" iconOnly icon={<Pencil />} to={`/letters/relieving/${l.id}`} title="Edit & regenerate" />} />)}
              </DocGroup>
              <DocGroup title="Payslips" icon={<Receipt />} action={<Button size="sm" variant="ghost" to="/payroll">Payroll →</Button>} empty="Payslips appear here once payroll is finalised.">
                {e.payslips.map((p, i) => <DocRow key={p.id} index={i} kind="payslip" title={monthLabel(p.month)} sub={<>{p.number} · Net <span className="tnum">{inr(p.net)}</span></>} url={p.file_url} />)}
              </DocGroup>
              <DocGroup title="Other documents" icon={<FileText />} action={<Button size="sm" icon={<Upload />} onClick={() => setUpload(true)}>Upload</Button>} empty="ID proofs, certificates, agreements…">
                {e.documents.map((d, i) => (
                  <DocRow key={d.id} index={i} kind="doc" title={d.title} sub={`${d.original_name ?? ""} · ${fmtDate(d.created_at)}`} url={d.file_url}
                    badge={<>{d.archived && <Badge>Archived</Badge>}{!d.visible_to_employee && <Badge tone="warn">Founder only</Badge>}</>}
                    extra={<>
                      <Button size="sm" variant="ghost" iconOnly icon={d.visible_to_employee ? <EyeOff /> : <Eye />} title={d.visible_to_employee ? "Hide from employee" : "Show to employee"} onClick={() => docAction.mutate({ docId: d.id, action: "visibility" })} />
                      <Button size="sm" variant="ghost" iconOnly icon={d.archived ? <ArchiveRestore /> : <Archive />} title={d.archived ? "Restore" : "Archive"} onClick={() => docAction.mutate({ docId: d.id, action: "archive" })} />
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete" onClick={async () => {
                        if (await confirm({ title: "Delete document?", message: `“${d.title}” will be permanently deleted.`, danger: true, confirmText: "Delete" })) docAction.mutate({ docId: d.id, action: "delete" });
                      }} />
                    </>} />
                ))}
              </DocGroup>
            </div>
          )}

          {tab === "payroll" && (
            <Card className="overflow-hidden">
              {e.payroll.length ? (
                <div className="overflow-x-auto"><table className="tbl">
                  <thead><tr><th>Month</th><th className="text-right">Basic</th><th className="text-right">Allowances</th><th className="text-right">Bonus</th><th className="text-right">Deductions</th><th className="text-right">Net</th><th>Status</th><th /></tr></thead>
                  <tbody>{e.payroll.map((r) => (
                    <tr key={r.id}>
                      <td><Link className="font-medium hover:text-brand-300" to={`/payroll/${r.month}`}>{monthLabel(r.month)}</Link></td>
                      <td className="text-right tnum text-fg-2">{inr(r.basic)}</td><td className="text-right tnum text-fg-2">{inr(r.allowances)}</td>
                      <td className="text-right tnum text-fg-2">{inr(r.bonus)}</td><td className="text-right tnum text-fg-2">{inr(r.deductions)}</td>
                      <td className="text-right tnum font-semibold">{inr(r.net)}</td>
                      <td>{r.status === "finalized" ? <Badge tone="good" dot>Finalised</Badge> : <Badge tone="warn" dot>Draft</Badge>}</td>
                      <td className="text-right">{r.payslip && <Button size="xs" variant="ghost" href={r.payslip.file_url} icon={<Receipt />}>Payslip</Button>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <EmptyState icon={<Wallet />} title="No payroll yet" text="Create a payroll month to include this employee." action={<Button to="/payroll">Go to payroll</Button>} />}
            </Card>
          )}

          {tab === "team" && <EmployeeTeam e={e} />}
          {tab === "leaves" && <EmployeeLeaves id={e.id} />}
          {tab === "tasks" && <EmployeeTasks id={e.id} />}

          {tab === "access" && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-4">
                <LoginCard e={e} onDone={(emp, pw) => { refresh(emp); if (pw) setTempPw({ email: emp.login!.email, password: pw }); }} />
                {user?.is_primary && <AdminAccessCard e={e} onDone={refresh} />}
              </div>
              <Card>
                <CardHeader icon={<Power />} title="Manage employee" subtitle="Deactivation keeps records; deletion removes them." />
                <div className="px-6 pb-6 space-y-3">
                  <div className="flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <div className="flex-1">
                      <div className="font-medium">{e.status === "active" ? "Deactivate" : "Reactivate"} employee</div>
                      <div className="text-[12.5px] text-fg-3">{e.status === "active" ? "Excludes from new payrolls and blocks portal login." : "Bring back to payroll and allow login again."}</div>
                    </div>
                    <Button loading={toggle.isPending} icon={<Power />} onClick={async () => {
                      if (e.status === "inactive" || await confirm({ title: `Deactivate ${e.full_name}?`, message: "They'll be excluded from new payrolls and their login stops working immediately.", confirmText: "Deactivate" })) toggle.mutate();
                    }}>{e.status === "active" ? "Deactivate" : "Reactivate"}</Button>
                  </div>
                  <div className="flex items-center gap-4 rounded-xl border border-bad/20 bg-bad/[0.04] p-4">
                    <div className="flex-1">
                      <div className="font-medium text-rose-200">Delete permanently</div>
                      <div className="text-[12.5px] text-fg-3">Removes the employee, login, letters, payslips and uploads. Posted payroll expenses stay in Finance.</div>
                    </div>
                    <Button variant="danger" icon={<Trash2 />} loading={remove.isPending} disabled={isSelf} onClick={askDelete}>Delete</Button>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <UploadModal open={upload} onClose={() => setUpload(false)} empId={e.id} onDone={() => { setUpload(false); refresh(); setTab("documents"); }} />

      <Modal open={!!tempPw} onClose={() => setTempPw(null)} title="Login created" subtitle="Share these credentials privately. The password won't be shown again."
        footer={<Button variant="primary" onClick={() => setTempPw(null)}>Done</Button>}>
        {tempPw && (
          <div className="space-y-3">
            {[["Email", tempPw.email], ["Temporary password", tempPw.password]].map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex-1 min-w-0"><div className="text-[12px] text-fg-4">{k}</div><div className="font-mono text-[15px] truncate">{v}</div></div>
                <Button size="sm" variant="ghost" iconOnly icon={<Copy />} title="Copy" onClick={() => { navigator.clipboard.writeText(v); toast.success(`${k} copied`); }} />
              </div>
            ))}
            <p className="text-[12.5px] text-fg-3">They sign in at this same address and can change the password from their account menu.</p>
          </div>
        )}
      </Modal>
    </>
  );
}

function Info({ rows }: { rows: [ReactNode, string, ReactNode][] }) {
  return (
    <div className="px-6 pb-6 space-y-4">
      {rows.map(([icon, k, v]) => (
        <div key={k} className="flex gap-3">
          <span className="mt-0.5 text-fg-4 [&>svg]:size-4">{icon}</span>
          <div className="min-w-0">
            <div className="text-[12px] text-fg-4">{k}</div>
            <div className="text-[14px] text-fg whitespace-pre-line break-words">{v || <span className="text-fg-4">—</span>}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DocGroup({ title, icon, action, children, empty }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode[]; empty: string }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={icon} title={title} action={action} />
      <div className="border-t divider divide-y divide-white/[0.05]">
        {children.length ? children : <div className="px-5 py-6 text-[13px] text-fg-4">{empty}</div>}
      </div>
    </Card>
  );
}

function LoginCard({ e, onDone }: { e: Profile; onDone: (emp: Profile, tempPassword: string | null) => void }) {
  const [email, setEmail] = useState(e.login?.email ?? e.email ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const m = useMutation({
    mutationFn: (action: string) => api.post<{ employee: Profile; temp_password: string | null; message: string }>(`/employees/${e.id}/login`, { action, email, password }),
    onSuccess: (r) => { toast.success(r.message); setPassword(""); onDone(r.employee, r.temp_password); },
  });
  const enabled = e.login?.active && e.status === "active";
  return (
    <Card glow>
      <CardHeader icon={<KeyRound />} title="Portal login" subtitle="Employee sees only their own profile, documents and payslips."
        action={e.login ? (enabled ? <Badge tone="good" dot>Enabled</Badge> : <Badge dot>Disabled</Badge>) : <Badge>Not created</Badge>} />
      <div className="px-6 pb-6 space-y-4">
        {e.login?.last_login_at && <div className="text-[12.5px] text-fg-3">Last sign-in {fmtDateTime(e.login.last_login_at)}</div>}
        <Field label="Login email"><Input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} /></Field>
        <Field label={e.login ? "New password" : "Password"} hint="Leave blank to generate a secure temporary password.">
          <div className="relative">
            <Input type={showPw ? "text" : "password"} value={password} onChange={(ev) => setPassword(ev.target.value)} autoComplete="new-password" placeholder="••••••••" className="pr-11" />
            <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-fg-4 hover:text-fg" aria-label={showPw ? "Hide password" : "Show password"}>
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {e.login && (e.login.active
            ? <Button variant="danger" size="sm" loading={m.isPending && m.variables === "disable"} onClick={() => m.mutate("disable")}>Disable login</Button>
            : <Button size="sm" loading={m.isPending && m.variables === "enable"} onClick={() => m.mutate("enable")}>Enable login</Button>)}
          <Button variant="primary" size="sm" icon={<KeyRound />} loading={m.isPending && m.variables === "save"} onClick={() => m.mutate("save")}>{e.login ? "Update login" : "Create login"}</Button>
        </div>
      </div>
    </Card>
  );
}

function UploadModal({ open, onClose, empId, onDone }: { open: boolean; onClose: () => void; empId: number; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [visible, setVisible] = useState(true);
  const m = useMutation({
    mutationFn: () => api.post(`/employees/${empId}/documents`, toForm({ title, notes, visible }, { file })),
    onSuccess: () => { toast.success("Document uploaded"); setFile(null); setTitle(""); setNotes(""); onDone(); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Upload document" subtitle="PDF, image, Word, Excel or text · max 15 MB"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Upload />} disabled={!file} loading={m.isPending} onClick={() => m.mutate()}>Upload</Button></>}>
      <div className="space-y-4">
        <FileDrop file={file} onFile={(f) => { setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "")); }} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt" hint="Drag & drop or click" />
        <Field label="Title"><Input value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="e.g. Aadhaar card" /></Field>
        <Field label="Notes" optional><Input value={notes} onChange={(ev) => setNotes(ev.target.value)} /></Field>
        <Toggle checked={visible} onChange={setVisible} label="Visible to employee in their portal" />
      </div>
    </Modal>
  );
}


function AdminAccessCard({ e, onDone }: { e: Profile; onDone: (emp: Profile) => void }) {
  const confirm = useConfirm();
  const { data } = useQuery({ queryKey: ["permissions"], queryFn: () => api.get<{ permissions: AreaInfo[] }>("/permissions"), staleTime: Infinity });
  const areas = data?.permissions ?? [];
  const granted = e.login?.permissions ?? [];
  const [picked, setPicked] = useState<Area[]>(granted);
  const saved = granted.join() === [...picked].sort().join();
  const all = areas.length > 0 && picked.length === areas.length;
  const m = useMutation({
    mutationFn: (permissions: Area[]) => api.post<{ employee: Profile; message: string }>(`/employees/${e.id}/admin`, { permissions }),
    onSuccess: (r) => { onDone(r.employee); setPicked(r.employee.login?.permissions ?? []); toast.success(r.message); },
  });
  const flip = (k: Area) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const save = async () => {
    if (!e.login) { toast.error("Create a portal login for this employee first."); return; }
    const adding = picked.filter((k) => !granted.includes(k));
    if (adding.length && !(await confirm({
      title: `Give ${e.full_name} access to ${adding.length === 1 ? areas.find((a) => a.key === adding[0])?.label : `${adding.length} areas`}?`,
      message: "They will be able to see and change everything in the areas you tick. Only you can change this later.",
      confirmText: "Save access",
    }))) return;
    m.mutate(picked);
  };
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute -right-12 -top-12 size-40 rounded-full bg-brand-500/15 blur-3xl" />
      <CardHeader icon={<ShieldCheck />} title="Admin access" subtitle="Founder-only control · choose what they can use"
        action={!granted.length ? <Badge>Not granted</Badge> : granted.length === areas.length ? <Badge tone="brand" dot>Full access</Badge> : <Badge tone="brand" dot>{granted.length} of {areas.length} areas</Badge>} />
      <div className="relative px-6 pb-6">
        <p className="text-[13px] text-fg-3 leading-relaxed">
          Tick the parts of the console this person may use. They can never grant access or change their own salary.
          {!e.login && <span className="block mt-1 text-warn">Create a portal login first.</span>}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-fg-4">{picked.length} selected</span>
          <div className="flex gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setPicked(all ? [] : areas.map((a) => a.key))} disabled={!e.login}>{all ? "Clear all" : "Select all"}</Button>
          </div>
        </div>
        <div className="mt-2 space-y-2">
          {areas.map((a) => {
            const on = picked.includes(a.key);
            return (
              <label key={a.key} className={cn("flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors",
                on ? "border-brand-400/40 bg-brand-500/[0.07]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/15",
                !e.login && "opacity-50 cursor-not-allowed")}>
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand-500)]" checked={on} disabled={!e.login} onChange={() => flip(a.key)} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium">{a.label}</span>
                  <span className="block text-[12.5px] text-fg-3 leading-snug">{a.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {!saved && <Button size="sm" variant="ghost" onClick={() => setPicked(granted)}>Reset</Button>}
          <Button size="sm" variant="primary" icon={<ShieldCheck />} disabled={saved || !e.login} loading={m.isPending} onClick={save}>
            {picked.length ? "Save access" : "Remove all access"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EmployeeTeam({ e }: { e: Profile }) {
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();
  const remove = useRemoveReport();
  const reports = e.reports ?? [];
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={<Network />} title={`Reports to ${e.full_name.split(" ")[0]}`}
        subtitle={reports.length ? `${reports.length} direct report${reports.length === 1 ? "" : "s"} · they can be assigned tasks by ${e.full_name.split(" ")[0]}` : "No one reports to this person yet"}
        action={<Button size="sm" variant="primary" icon={<UserPlus />} onClick={() => setAdding(true)}>Add people</Button>} />
      {reports.length ? (
        <div className="border-t divider divide-y divide-white/[0.05]">
          {reports.map((r) => (
            <div key={r.id} className="flex items-center gap-3.5 px-6 py-3">
              <Avatar person={r} size={36} />
              <Link to={`/employees/${r.id}`} className="flex-1 min-w-0 group">
                <div className="font-medium truncate group-hover:text-brand-300">{r.full_name}</div>
                <div className="text-[12.5px] text-fg-4 truncate"><span className="font-mono">{r.emp_code}</span> · {r.designation ?? "—"}</div>
              </Link>
              <Badge>{r.employment_type ?? "Full-time"}</Badge>
              {r.status !== "active" && <StatusBadge status={r.status} />}
              <Button size="xs" variant="ghost" icon={<X />} onClick={async () => {
                if (await confirm({ title: `Remove ${r.full_name} from ${e.full_name}'s team?`, message: "They'll report directly to the founder. You can put them under someone else later.", confirmText: "Remove" }))
                  remove.mutate({ managerId: e.id, remove: [r.id] });
              }}>Remove</Button>
            </div>
          ))}
        </div>
      ) : <EmptyState icon={<Network />} title="No team yet" text="Put interns or other employees under this person — they'll appear below them in the team tree." action={<Button icon={<UserPlus />} onClick={() => setAdding(true)}>Add people</Button>} />}
      <AddReportsModal manager={e} open={adding} onClose={() => setAdding(false)} />
    </Card>
  );
}

function EmployeeLeaves({ id }: { id: number }) {
  const { data } = useQuery({ queryKey: ["leaves", "employee", id], queryFn: () => api.get<{ leaves: Leave[] }>(`/leaves?status=all&employee_id=${id}`) });
  const rows = data?.leaves ?? [];
  const year = new Date().getFullYear();
  const taken = rows.filter((l) => l.status === "approved" && l.start_date.startsWith(String(year))).reduce((s, l) => s + l.days, 0);
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={<CalendarDays />} title="Leave history" subtitle={`${taken} day${taken === 1 ? "" : "s"} approved in ${year}`} action={<Button size="sm" to="/leaves">Open leaves</Button>} />
      {rows.length ? (
        <div className="overflow-x-auto border-t divider"><table className="tbl">
          <thead><tr><th>Dates</th><th>Type</th><th className="text-right">Days</th><th>Status</th><th>Reason</th></tr></thead>
          <tbody>{rows.map((l) => (
            <tr key={l.id}>
              <td className="whitespace-nowrap">{fmtDate(l.start_date)}{l.end_date !== l.start_date && ` → ${fmtDate(l.end_date)}`}</td>
              <td className="text-fg-2">{l.leave_type}{l.half_day && " · ½"}</td>
              <td className="text-right tnum">{l.days}</td>
              <td><LeaveStatusBadge status={l.status} /></td>
              <td className="text-fg-3 max-w-[280px] truncate">{l.reason ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <EmptyState icon={<CalendarDays />} title="No leaves yet" />}
    </Card>
  );
}

function EmployeeTasks({ id }: { id: number }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["tasks", "employee", id], queryFn: () => api.get<{ tasks: Task[] }>(`/tasks?scope=all&assignee_id=${id}`) });
  const rows = data?.tasks ?? [];
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={<ListTodo />} title="Tasks" subtitle={`${rows.filter((t) => t.status !== "done").length} open · ${rows.filter((t) => t.status === "done").length} done`} action={<Button size="sm" to="/tasks">Open tasks</Button>} />
      {rows.length ? (
        <div className="border-t divider divide-y divide-white/[0.05]">
          {rows.map((t) => (
            <button key={t.id} type="button" onClick={() => setOpenId(t.id)} className="w-full text-left flex items-center gap-4 px-6 py-3.5 hover:bg-white/[0.03] transition-colors">
              <div className="flex-1 min-w-0">
                <div className={cn("font-medium truncate", t.status === "done" && "line-through text-fg-3")}>{t.title}</div>
                <div className="text-[12.5px] text-fg-4">by {t.created_by_name ?? "—"}{t.due_date && ` · due ${fmtDate(t.due_date)}`}</div>
              </div>
              {t.items_total > 0 && <Badge tone={t.items_done === t.items_total ? "good" : "neutral"}><ListChecks className="size-3" />{t.items_done}/{t.items_total}</Badge>}
              <PriorityBadge p={t.priority} />
              <TaskStatusBadge s={t.status} />
            </button>
          ))}
        </div>
      ) : <EmptyState icon={<ListTodo />} title="No tasks yet" />}
      <TaskDetailDrawer taskId={openId} onClose={() => setOpenId(null)} onEdit={() => navigate("/tasks")} />
    </Card>
  );
}
