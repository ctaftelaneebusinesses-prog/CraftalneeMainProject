import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BriefcaseBusiness, Check, Landmark, Lock, Network, Shapes, UserRound } from "lucide-react";
import { api, toForm } from "@/lib/api";
import { useEmployeeOptions, useFormState, useMeta } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { EmployeeProfile } from "@/lib/types";
import { Avatar, Button, Card, Field, Input, MoneyInput, PageHeader, PageSkeleton, Textarea } from "@/components/ui/core";
import { FileDrop } from "@/components/ui/overlay";
import { RoleInput } from "@/components/RoleInput";
import { EmploymentTypePicker } from "@/components/EmploymentTypePicker";
import { PersonSelect } from "@/components/PersonSelect";

const EMPTY = {
  emp_code: "", full_name: "", phone: "", email: "", date_of_birth: "", address: "",
  department: "", joining_date: "", end_date: "", employment_type: "Full-time", work_location: "",
  monthly_salary: "", salary_effective_date: "", bank_name: "", bank_account_name: "", bank_account_number: "", bank_ifsc: "",
};
type Values = typeof EMPTY;

/** What the ID is called for each employment type (mirrors EMP_CODE_PREFIX in craftlanee/models.py). */
export const ID_LABEL: Record<string, string> = {
  "Full-time": "Employee ID", "Part-time": "Part-time ID", Contract: "Contract ID",
  Freelancer: "Freelancer ID", Intern: "Intern ID", Trainee: "Trainee ID",
};

function Section({ icon, title, text, children }: { icon: ReactNode; title: string; text: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 px-6 sm:px-8 py-7 border-b divider last:border-0">
      <div>
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center size-8 rounded-lg bg-brand-500/15 text-brand-300 [&>svg]:size-4">{icon}</span>
          <h3 className="font-display font-semibold text-[15px]">{title}</h3>
        </div>
        <div className="text-[13px] text-fg-3 mt-2 leading-relaxed">{text}</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-5">{children}</div>
    </div>
  );
}

export default function EmployeeForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useMeta();
  const { user } = useSession();
  const { data: options } = useEmployeeOptions();
  const { values, setValues, bind, set } = useFormState<Values>(EMPTY);
  const [roles, setRoles] = useState<string[]>([]);
  const [managerId, setManagerId] = useState<number | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [typeChosen, setTypeChosen] = useState(editing);
  const [codeTouched, setCodeTouched] = useState(false);
  const isSelf = editing && user?.employee?.id === Number(id) && !user?.is_owner;

  const existing = useQuery({ queryKey: ["employee", id], queryFn: () => api.get<{ employee: EmployeeProfile }>(`/employees/${id}`), enabled: editing });
  const list = useQuery({ queryKey: ["employees", "next-code"], queryFn: () => api.get<{ next_code: string; next_codes: Record<string, string> }>("/employees?status=all"), enabled: !editing });

  useEffect(() => {
    const e = existing.data?.employee;
    if (!e) return;
    const v = { ...EMPTY };
    (Object.keys(EMPTY) as (keyof Values)[]).forEach((k) => {
      const raw = (e as unknown as Record<string, unknown>)[k];
      v[k] = raw === null || raw === undefined ? "" : String(raw);
    });
    setValues(v);
    setRoles(e.roles?.length ? e.roles : e.designation ? [e.designation] : []);
    setManagerId(e.manager_id);
  }, [existing.data, setValues]);
  // New people get the next ID in their employment type's series (CL-INT-0001, CL-FREE-0001, ...),
  // and it follows the type until the founder types their own.
  const suggestedCode = list.data?.next_codes?.[values.employment_type] ?? "";
  useEffect(() => { if (!editing && !codeTouched && suggestedCode) set("emp_code", suggestedCode); }, [suggestedCode, editing, codeTouched, set]);
  const chooseType = (t: string) => { set("employment_type", t); setTypeChosen(true); };

  const save = useMutation({
    mutationFn: () => {
      const fd = toForm({ ...values, roles: JSON.stringify(roles), manager_id: managerId ?? "" }, { photo });
      return editing ? api.put<{ employee: EmployeeProfile }>(`/employees/${id}`, fd) : api.post<{ employee: EmployeeProfile }>("/employees", fd);
    },
    onSuccess: (res) => {
      ["employees", "employee-options", "dashboard", "org"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.setQueryData(["employee", String(res.employee.id)], { employee: res.employee });
      toast.success(editing ? "Employee updated" : `${res.employee.full_name} added to the team`);
      navigate(`/employees/${res.employee.id}`);
    },
  });

  const people = useMemo(() => (options?.employees ?? []).filter((o) => o.status === "active"), [options]);
  const suggestions = useMemo(() => Array.from(new Set((options?.employees ?? []).flatMap((o) => o.roles ?? []))), [options]);
  if (editing && existing.isLoading) return <PageSkeleton />;
  const fixedTerm = meta.fixed_term_types.includes(values.employment_type);
  const stipend = meta.stipend_types.includes(values.employment_type);
  const preview = existing.data?.employee;
  const submit = (e: FormEvent) => { e.preventDefault(); if (!roles.length) { toast.error("Add at least one role."); return; } save.mutate(); };

  return (
    <form onSubmit={submit}>
      <PageHeader back={editing ? { to: `/employees/${id}`, label: preview?.full_name ?? "Employee" } : { to: "/employees", label: "Employees" }}
        eyebrow={editing ? "Edit employee" : "New employee"} title={editing ? values.full_name || "Edit employee" : "Add a team member"}
        subtitle="Only admins and this employee can see salary details. Employees can update their own contact details & photo." />

      <Card className="overflow-visible">
        <Section icon={<Shapes />} title="Employment type" text={editing ? "Changing the type keeps the existing ID." : <>Choose this first — it decides the ID series: <span className="font-mono text-fg-2">CL-EMP</span>, <span className="font-mono text-fg-2">CL-INT</span>, <span className="font-mono text-fg-2">CL-FREE</span> and so on.</>}>
          <Field label="Employment type" className="sm:col-span-2">
            <EmploymentTypePicker value={typeChosen ? values.employment_type : ""} onChange={chooseType} types={meta.employment_types} />
          </Field>
        </Section>

        {typeChosen ? (<>
        <Section icon={<UserRound />} title="Basic details" text="Personal and contact information.">
          <div className="sm:col-span-2 flex flex-col sm:flex-row gap-5 sm:items-center">
            {preview && !photo ? <Avatar person={preview} size={72} ring /> : null}
            <FileDrop className="flex-1" file={photo} onFile={setPhoto} accept=".png,.jpg,.jpeg,.webp" label="Upload profile photo" hint="PNG, JPG or WebP" />
          </div>
          <Field label={ID_LABEL[values.employment_type] ?? "Employee ID"} hint={editing ? "Existing IDs don't change if the type changes." : `Next in the ${values.employment_type} series — you can change it.`}>
            <Input value={values.emp_code} onChange={(e) => { setCodeTouched(true); set("emp_code", e.target.value); }} required className="font-mono" />
          </Field>
          <Field label="Full name"><Input {...bind("full_name")} required autoFocus={editing} placeholder="e.g. John Mathew" /></Field>
          <Field label="Phone"><Input {...bind("phone")} type="tel" placeholder="+91" /></Field>
          <Field label="Email"><Input {...bind("email")} type="email" /></Field>
          <Field label="Date of birth"><Input {...bind("date_of_birth")} type="date" /></Field>
          <div />
          <Field label="Address" className="sm:col-span-2"><Textarea {...bind("address")} rows={3} className="min-h-[88px]" /></Field>
        </Section>

        <Section icon={<BriefcaseBusiness />} title="Roles & employment" text={<>One person can hold <b className="text-fg-2">several roles</b> — e.g. CEO, Full Stack Developer, Project Manager and HR. The first is the primary designation used in letters.</>}>
          <Field label="Roles" className="sm:col-span-2" hint="Type and press Enter, or pick a suggestion. The first role is the primary designation.">
            <RoleInput value={roles} onChange={setRoles} suggestions={suggestions} />
          </Field>
          <Field label="Department"><Input {...bind("department")} placeholder="e.g. IT" /></Field>
          <Field label="Work location"><Input {...bind("work_location")} placeholder="e.g. Kochi / Remote" /></Field>
          <Field label={stipend ? "Start date" : "Joining date"}><Input {...bind("joining_date")} type="date" /></Field>
          {fixedTerm ? <Field label={stipend ? "Internship end date" : "Contract end date"}><Input {...bind("end_date")} type="date" /></Field> : <div />}
        </Section>

        <Section icon={<Network />} title="Reporting line" text="Builds the team tree. Leaders can assign tasks to everyone below them.">
          <Field label="Reports to" className="sm:col-span-2">
            <PersonSelect people={people} value={managerId} onChange={setManagerId} noneLabel="Reports directly to the founder" exclude={id ? [Number(id)] : []} />
          </Field>
        </Section>

        <Section icon={<Landmark />} title={stipend ? "Stipend & bank" : "Salary & bank"} text={<>Admin-only fields. {stipend ? "Monthly stipend" : "Monthly salary"} becomes the default in payroll.{isSelf && <span className="flex items-center gap-1.5 mt-2 text-warn"><Lock className="size-3.5" /> You can't change your own salary.</span>}</>}>
          <Field label={stipend ? "Monthly stipend" : "Monthly salary"}>
            <MoneyInput value={values.monthly_salary} onChange={(v) => set("monthly_salary", v)} required placeholder="0" disabled={isSelf} />
          </Field>
          <Field label="Effective date"><Input {...bind("salary_effective_date")} type="date" /></Field>
          <Field label="Bank name" optional><Input {...bind("bank_name")} /></Field>
          <Field label="Account holder name" optional><Input {...bind("bank_account_name")} /></Field>
          <Field label="Account number" optional><Input {...bind("bank_account_number")} autoComplete="off" className="font-mono" /></Field>
          <Field label="IFSC" optional><Input {...bind("bank_ifsc")} autoComplete="off" className="font-mono uppercase" /></Field>
        </Section>
        </>) : (
          <div className="px-6 sm:px-8 py-10 text-center text-[13.5px] text-fg-3">Pick an employment type above to continue.</div>
        )}

        <div className="sticky bottom-0 z-10 flex justify-end gap-2 px-6 sm:px-8 py-4 border-t divider panel backdrop-blur-xl rounded-b-[20px]">
          <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
          <Button variant="primary" type="submit" icon={<Check />} loading={save.isPending} disabled={!typeChosen}>{editing ? "Save changes" : "Add employee"}</Button>
        </div>
      </Card>
    </form>
  );
}
