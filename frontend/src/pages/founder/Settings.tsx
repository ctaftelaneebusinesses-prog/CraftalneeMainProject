import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Activity, Building2, Check, FileText, KeyRound, Lock, Palette, PartyPopper, PenLine, RotateCcw } from "lucide-react";
import { api, toForm } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { CompanySettings } from "@/lib/types";
import { Button, Card, Field, Input, PageHeader, PageSkeleton, Textarea, Toggle } from "@/components/ui/core";
import { FileDrop } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/core";
import { RichTextEditor } from "@/components/RichTextEditor";

const TEXT = ["company_name", "tagline", "address", "phone", "email", "website", "gstin", "founder_name", "founder_designation", "hr_name", "hr_designation", "offer_terms", "internship_terms", "joining_body", "relieving_body", "mou_terms"] as const;
type RichKey = "offer_terms" | "internship_terms" | "joining_body" | "relieving_body" | "mou_terms";
const RICH_TABS: { value: RichKey; label: string; hint: string }[] = [
  { value: "offer_terms", label: "Offer T&C", hint: "Terms & conditions on employment offer letters." },
  { value: "internship_terms", label: "Internship T&C", hint: "Terms & conditions on internship offer letters (interns & trainees)." },
  { value: "joining_body", label: "Joining letter", hint: "Body of joining letters. Placeholders: {name} {company} {designation} {department} {joining_date} {reporting_person} {emp_code}" },
  { value: "relieving_body", label: "Relieving letter", hint: "Body of relieving letters. Placeholders: {name} {company} {designation} {department} {joining_date} {last_working_day} {emp_code}" },
  { value: "mou_terms", label: "MOU clauses", hint: "Default terms & conditions for new MOUs." },
];
type Key = typeof TEXT[number];
type Img = "logo" | "signature" | "hr_signature" | "letterhead";

function Section({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 px-6 sm:px-8 py-7 border-b divider last:border-0">
      <div>
        <div className="flex items-center gap-2.5"><span className="grid place-items-center size-8 rounded-lg bg-brand-500/15 text-brand-300 [&>svg]:size-4">{icon}</span><h3 className="font-display font-semibold text-[15px]">{title}</h3></div>
        <p className="text-[13px] text-fg-3 mt-2 leading-relaxed">{text}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">{children}</div>
    </div>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { session, setSession, user } = useSession();
  const [params] = useSearchParams();
  const welcome = params.get("welcome");
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ settings: CompanySettings; defaults: Record<RichKey, string>; signature_owner: string }>("/settings") });
  const [richTab, setRichTab] = useState<RichKey>("offer_terms");
  const [v, setV] = useState<Record<Key, string>>(Object.fromEntries(TEXT.map((k) => [k, ""])) as Record<Key, string>);
  const [files, setFiles] = useState<Record<Img, File | null>>({ logo: null, signature: null, hr_signature: null, letterhead: null });
  const [remove, setRemove] = useState<Record<Img, boolean>>({ logo: false, signature: false, hr_signature: false, letterhead: false });
  const [nameWithLogo, setNameWithLogo] = useState(false);

  useEffect(() => { if (data) setNameWithLogo(!!data.settings.show_name_with_logo); }, [data]);
  useEffect(() => {
    if (data) setV(Object.fromEntries(TEXT.map((k) => {
      const saved = (data.settings[k] as string | null) ?? "";
      const fallback = (data.defaults as Record<string, string>)[k];
      return [k, saved || fallback || ""];  // show the built-in default so it can be edited directly
    })) as Record<Key, string>);
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.post<{ settings: CompanySettings }>("/settings", toForm({ ...v, show_name_with_logo: nameWithLogo, remove_logo: remove.logo, remove_signature: remove.signature, remove_hr_signature: remove.hr_signature, remove_letterhead: remove.letterhead }, files)),
    onSuccess: (r) => {
      qc.setQueryData(["settings"], { ...data, settings: r.settings });
      setSession({ company: { company_name: r.settings.company_name, tagline: r.settings.tagline, logo_url: r.settings.logo_url } });
      setFiles({ logo: null, signature: null, hr_signature: null, letterhead: null });
      setRemove({ logo: false, signature: false, hr_signature: false, letterhead: false });
      toast.success("Settings saved — new documents will use these details");
    },
  });
  if (isLoading || !data) return <PageSkeleton />;
  const s = data.settings;
  const bind = (k: Key) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value }) });
  const locked = (k: Img) => (k === "signature" || k === "hr_signature") && !user?.can_edit_signatures;
  const img = (k: Img, label: string, hint: string, url: string | null) => locked(k) ? (
    <Field label={label} hint={<span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" />Only {data.signature_owner} can change signatures.</span>}>
      <div className="grid place-items-center h-[120px] rounded-xl border border-white/[0.08] bg-[#fff] p-3">
        {url ? <img src={url} alt={label} className="max-h-full max-w-full object-contain" /> : <span className="text-[13px] text-[#888]">No signature uploaded</span>}
      </div>
    </Field>
  ) : (
    <Field label={label} className={k === "letterhead" ? "sm:col-span-2" : ""}>
      <FileDrop file={files[k]} onFile={(f) => setFiles({ ...files, [k]: f })} accept=".png,.jpg,.jpeg,.webp" label={url && !remove[k] ? "Replace image" : `Upload ${label.toLowerCase()}`} hint={hint} preview={!remove[k] ? url : null} />
      {url && !files[k] && <label className="mt-2 inline-flex items-center gap-2 text-[12.5px] text-fg-3 cursor-pointer"><input type="checkbox" className="accent-[#7c5cff]" checked={remove[k]} onChange={(e) => setRemove({ ...remove, [k]: e.target.checked })} /> Remove current</label>}
    </Field>
  );

  return (
    <>
      <PageHeader eyebrow="Settings" title="Company settings" subtitle="These details appear automatically on every generated PDF."
        actions={<><Button icon={<Activity />} to="/settings/audit">Audit log</Button><Button icon={<KeyRound />} to="/account">Password</Button></>} />

      {welcome && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4 rounded-2xl border border-brand-500/30 bg-gradient-to-r from-brand-500/15 via-flame-500/5 to-transparent px-5 py-4 mb-6">
          <span className="grid place-items-center size-10 rounded-xl text-on-accent" style={{ background: "var(--grad)" }}><PartyPopper className="size-5" /></span>
          <div><div className="font-semibold">Welcome to {session?.company?.company_name}! 🎉</div><div className="text-[13px] text-fg-3">Add your address, logo and signature — then start adding employees.</div></div>
        </motion.div>
      )}

      <Card className="overflow-visible">
        <Section icon={<Building2 />} title="Company" text="Name and contact details for the letterhead and footer.">
          <Field label="Company name"><Input {...bind("company_name")} required /></Field>
          <Field label="Tagline" optional><Input {...bind("tagline")} placeholder="e.g. Crafting digital experiences" /></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea {...bind("address")} rows={3} className="min-h-[88px]" /></Field>
          <Field label="Phone"><Input {...bind("phone")} /></Field>
          <Field label="Email"><Input type="email" {...bind("email")} /></Field>
          <Field label="Website"><Input {...bind("website")} placeholder="www.craftlanee.com" /></Field>
          <Field label="GSTIN" optional><Input {...bind("gstin")} className="font-mono uppercase" /></Field>
        </Section>
        <Section icon={<PenLine />} title="Signatory" text="Signs offer letters, joining letters, MOUs and payslips.">
          <Field label="Founder name"><Input {...bind("founder_name")} /></Field>
          <Field label="Designation"><Input {...bind("founder_designation")} /></Field>
        </Section>
        <Section icon={<PenLine />} title="HR signatory" text="Co-signs offer, joining and relieving letters and payslips next to the founder.">
          <Field label="HR name"><Input {...bind("hr_name")} required /></Field>
          <Field label="Designation"><Input {...bind("hr_designation")} placeholder="Manager" required /></Field>
          {img("hr_signature", "HR signature", "Scan on white or transparent", s.hr_signature_url)}
        </Section>
        <Section icon={<Palette />} title="Branding" text="Transparent PNGs look best. A letterhead image, if set, replaces the logo header on PDFs.">
          {img("logo", "Logo", "Square or wide · sidebar & PDFs", s.logo_url)}
          <div className="sm:col-span-2 -mt-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <Toggle checked={nameWithLogo} onChange={setNameWithLogo}
              label={<span><b className="text-fg">Also print the company name next to the logo</b>
                <span className="block text-[12px] text-fg-3">Leave off if your logo already shows the name (like a wordmark) — otherwise it appears twice on PDFs.</span></span>} />
          </div>
          {img("signature", "Signature", "Scan on white or transparent", s.signature_url)}
          {img("letterhead", "Letterhead header", "Wide banner, about 1700 × 300 px", s.letterhead_url)}
        </Section>
        <div className="px-6 sm:px-8 py-7 border-b divider">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5"><span className="grid place-items-center size-8 rounded-lg bg-brand-500/15 text-brand-300"><FileText className="size-4" /></span>
              <div><h3 className="font-display font-semibold text-[15px]">Terms, conditions & letter defaults</h3><p className="text-[12.5px] text-fg-3">Pre-filled into every new document — each one can still be edited individually.</p></div></div>
            <Segmented layoutId="rich-tab" value={richTab} onChange={setRichTab} options={RICH_TABS.map(({ value, label }) => ({ value, label }))} />
          </div>
          {RICH_TABS.filter((t) => t.value === richTab).map((t) => (
            <div key={t.value}>
              <div className="flex items-center justify-between gap-3 mb-2.5">
                <p className="text-[12.5px] text-fg-4">{t.hint}</p>
                <Button size="xs" variant="ghost" icon={<RotateCcw />} onClick={() => setV({ ...v, [t.value]: data.defaults[t.value] })}>Reset to default</Button>
              </div>
              <RichTextEditor value={v[t.value]} onChange={(h) => setV((cur) => ({ ...cur, [t.value]: h }))} minHeight={300} />
            </div>
          ))}
        </div>
        <div className="sticky bottom-0 z-10 flex justify-end gap-2 px-6 sm:px-8 py-4 border-t divider panel backdrop-blur-xl">
          <Button variant="primary" icon={<Check />} loading={save.isPending} onClick={() => {
            if (!v.hr_name.trim() || !v.hr_designation.trim()) { toast.error("HR name and designation are required"); return; }
            save.mutate();
          }}>Save settings</Button>
        </div>
      </Card>
    </>
  );
}
