import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { BriefcaseBusiness, Camera, Check, Landmark, Lock, Pencil, UserRound, X } from "lucide-react";
import { api, toForm } from "@/lib/api";
import { fmtDate, inr } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Session } from "@/lib/types";
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader, PageSkeleton, Textarea } from "@/components/ui/core";
import { RoleChips } from "@/pages/founder/Employees";
import { useMe } from "./useMe";

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="px-6 pb-6 space-y-3.5">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[130px_1fr] gap-3 text-[13.5px]">
          <dt className="text-fg-3">{k}</dt><dd className="text-fg whitespace-pre-line break-words">{v || <span className="text-fg-4">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

const Locked = () => <Badge className="h-6"><Lock className="size-3" /> Managed by admin</Badge>;

export default function PortalProfile() {
  const { data, isLoading } = useMe();
  const { session, setSession } = useSession();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ phone: "", email: "", date_of_birth: "", address: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const e = data?.employee;
  useEffect(() => { if (e) setF({ phone: e.phone ?? "", email: e.email ?? "", date_of_birth: e.date_of_birth ?? "", address: e.address ?? "" }); }, [e, edit]);

  const onSaved = (r: { employee: NonNullable<typeof e> }) => {
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["org"] });
    if (session?.user) setSession({ user: { ...session.user, employee: { ...session.user.employee!, photo_url: r.employee.photo_url } } } as Partial<Session>);
  };
  const save = useMutation({
    mutationFn: () => api.put<{ employee: NonNullable<typeof e> }>("/me/profile", toForm(f)),
    onSuccess: (r) => { onSaved(r); setEdit(false); toast.success("Profile updated"); },
  });
  const photo = useMutation({
    mutationFn: (file: File | null) => api.put<{ employee: NonNullable<typeof e> }>("/me/profile", file ? toForm({}, { photo: file }) : toForm({ remove_photo: true })),
    onSuccess: (r) => { onSaved(r); toast.success(r.employee.photo_url ? "Profile photo updated — everyone sees it now" : "Photo removed"); },
  });

  if (isLoading || !e) return <PageSkeleton />;
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: ev.target.value }) });

  return (
    <>
      <PageHeader eyebrow="My profile" title="Profile" subtitle="Keep your contact details and photo up to date. Job and salary details are managed by the founder & admins."
        actions={!edit ? <Button variant="primary" icon={<Pencil />} onClick={() => setEdit(true)}>Edit my details</Button>
          : <><Button variant="ghost" icon={<X />} onClick={() => setEdit(false)}>Cancel</Button><Button variant="primary" icon={<Check />} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button></>} />

      <Card className="relative overflow-hidden mb-5">
        <div className="absolute inset-0 opacity-60" style={{ background: "radial-gradient(ellipse at 0% 0%, rgba(124,92,255,0.25), transparent 55%)" }} />
        <div className="relative flex flex-wrap items-center gap-6 p-6">
          <button onClick={() => fileRef.current?.click()} className="group relative rounded-full" title="Change photo">
            <Avatar person={e} size={96} ring />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity text-[#fff]">
              {photo.isPending ? <span className="size-5 rounded-full border-2 border-[#fff] border-t-transparent animate-spin" /> : <Camera className="size-6" />}
            </span>
          </button>
          <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={(ev) => { const file = ev.target.files?.[0]; if (file) photo.mutate(file); ev.target.value = ""; }} />
          <div className="flex-1 min-w-[220px]">
            <div className="font-display text-[24px] font-bold">{e.full_name}</div>
            <div className="mt-1.5"><RoleChips roles={e.roles} max={6} /></div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="brand"><span className="font-mono">{e.emp_code}</span></Badge>
              <Badge>{e.employment_type}</Badge>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button size="sm" icon={<Camera />} onClick={() => fileRef.current?.click()}>{e.photo_url ? "Change photo" : "Add photo"}</Button>
            {e.photo_url && <Button size="sm" variant="ghost" onClick={() => photo.mutate(null)}>Remove</Button>}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader icon={<UserRound />} title="Personal" subtitle="You can edit these" />
          <AnimatePresence mode="wait" initial={false}>
            {edit ? (
              <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-6 pb-6 space-y-4">
                <Field label="Phone"><Input {...bind("phone")} type="tel" /></Field>
                <Field label="Email"><Input {...bind("email")} type="email" /></Field>
                <Field label="Date of birth"><Input {...bind("date_of_birth")} type="date" /></Field>
                <Field label="Address"><Textarea {...bind("address")} className="min-h-[90px]" /></Field>
              </motion.div>
            ) : (
              <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Rows rows={[["Phone", e.phone], ["Email", e.email], ["Date of birth", fmtDate(e.date_of_birth)], ["Address", e.address]]} />
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
        <Card>
          <CardHeader icon={<BriefcaseBusiness />} title="Job" action={<Locked />} />
          <Rows rows={[["Department", e.department], ["Joined", fmtDate(e.joining_date)], ["Type", e.employment_type], ...(e.end_date ? [["Ends", fmtDate(e.end_date)] as [string, ReactNode]] : []), ["Location", e.work_location], ["Reports to", e.manager?.full_name ?? e.reporting_person]]} />
        </Card>
        <Card>
          <CardHeader icon={<Landmark />} title="Salary & bank" action={<Locked />} />
          <Rows rows={[["Monthly pay", <span className="tnum font-semibold">{inr(e.monthly_salary)}</span>], ["Effective from", fmtDate(e.salary_effective_date)], ["Bank", e.bank_name], ["Account", e.bank_account_masked && <span className="font-mono">{e.bank_account_masked}</span>], ["IFSC", e.bank_ifsc && <span className="font-mono">{e.bank_ifsc}</span>]]} />
        </Card>
      </div>
    </>
  );
}
