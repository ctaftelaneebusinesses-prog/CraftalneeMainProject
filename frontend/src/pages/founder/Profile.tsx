import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Camera, Check, Pencil, UserRound, X } from "lucide-react";
import { api, toForm } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader, PageSkeleton, Textarea } from "@/components/ui/core";

type Profile = { name: string; email: string; designation: string | null; phone: string | null; date_of_birth: string | null;
  address: string | null; photo_url: string | null };
type Saved = { profile: Profile; user: User };

const EMPTY = { name: "", designation: "", phone: "", date_of_birth: "", address: "" };

/** Founder logins have no employee record, so their name, photo and personal details live on the login itself. */
export default function FounderProfile() {
  const qc = useQueryClient();
  const { setSession } = useSession();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(EMPTY);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ["founder-profile"], queryFn: () => api.get<{ profile: Profile }>("/auth/profile") });
  const p = data?.profile;
  useEffect(() => {
    if (p) setF({ name: p.name, designation: p.designation ?? "", phone: p.phone ?? "", date_of_birth: p.date_of_birth ?? "", address: p.address ?? "" });
  }, [p, edit]);

  const onSaved = (r: Saved) => { qc.setQueryData(["founder-profile"], { profile: r.profile }); setSession({ user: r.user }); };
  const save = useMutation({
    mutationFn: () => api.put<Saved>("/auth/profile", toForm(f)),
    onSuccess: (r) => { onSaved(r); setEdit(false); toast.success("Profile updated"); },
  });
  const photo = useMutation({
    mutationFn: (file: File | null) => api.put<Saved>("/auth/profile", file ? toForm({}, { photo: file }) : toForm({ remove_photo: true })),
    onSuccess: (r) => { onSaved(r); toast.success(r.profile.photo_url ? "Profile photo updated" : "Photo removed"); },
  });

  if (isLoading || !p) return <PageSkeleton />;
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: ev.target.value }) });
  const rows: [string, ReactNode][] = [["Name", p.name], ["Title", p.designation], ["Phone", p.phone], ["Date of birth", p.date_of_birth && fmtDate(p.date_of_birth)], ["Address", p.address]];

  return (
    <>
      <PageHeader eyebrow="My profile" title="Profile" subtitle="Your photo and personal details."
        actions={!edit ? <Button variant="primary" icon={<Pencil />} onClick={() => setEdit(true)}>Edit my details</Button>
          : <><Button variant="ghost" icon={<X />} onClick={() => setEdit(false)}>Cancel</Button>
            <Button variant="primary" icon={<Check />} loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Save changes</Button></>} />

      <Card className="relative overflow-hidden mb-5 max-w-[860px]">
        <div className="absolute inset-0 opacity-60" style={{ background: "radial-gradient(ellipse at 0% 0%, rgba(124,92,255,0.25), transparent 55%)" }} />
        <div className="relative flex flex-wrap items-center gap-6 p-6">
          <button onClick={() => fileRef.current?.click()} className="group relative rounded-full" title="Change photo">
            <Avatar person={{ photo_url: p.photo_url, initials: (p.name || "?").slice(0, 1).toUpperCase() }} size={96} ring />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity text-[#fff]">
              {photo.isPending ? <span className="size-5 rounded-full border-2 border-[#fff] border-t-transparent animate-spin" /> : <Camera className="size-6" />}
            </span>
          </button>
          <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={(ev) => { const file = ev.target.files?.[0]; if (file) photo.mutate(file); ev.target.value = ""; }} />
          <div className="flex-1 min-w-[220px]">
            <div className="font-display text-[24px] font-bold">{p.name}</div>
            <div className="text-fg-3 text-[13.5px]">{p.email}</div>
            <div className="mt-2 flex flex-wrap gap-2"><Badge tone="brand">{p.designation || "Founder"}</Badge></div>
          </div>
          <div className="flex flex-col gap-2">
            <Button size="sm" icon={<Camera />} onClick={() => fileRef.current?.click()}>{p.photo_url ? "Change photo" : "Add photo"}</Button>
            {p.photo_url && <Button size="sm" variant="ghost" onClick={() => photo.mutate(null)}>Remove</Button>}
          </div>
        </div>
      </Card>

      <Card className="max-w-[860px]">
        <CardHeader icon={<UserRound />} title="Personal details" subtitle="Your sign-in email is changed from Account & password." />
        <AnimatePresence mode="wait" initial={false}>
          {edit ? (
            <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full name"><Input {...bind("name")} maxLength={120} autoFocus /></Field>
              <Field label="Title" optional><Input {...bind("designation")} maxLength={120} placeholder="e.g. Founder & CEO" /></Field>
              <Field label="Phone" optional><Input {...bind("phone")} type="tel" maxLength={40} /></Field>
              <Field label="Date of birth" optional><Input {...bind("date_of_birth")} type="date" /></Field>
              <Field label="Address" optional className="sm:col-span-2"><Textarea {...bind("address")} className="min-h-[90px]" /></Field>
            </motion.div>
          ) : (
            <motion.dl key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-6 pb-6 space-y-3.5">
              {rows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[130px_1fr] gap-3 text-[13.5px]">
                  <dt className="text-fg-3">{k}</dt><dd className="text-fg whitespace-pre-line break-words">{v || <span className="text-fg-4">—</span>}</dd>
                </div>
              ))}
            </motion.dl>
          )}
        </AnimatePresence>
      </Card>
    </>
  );
}
