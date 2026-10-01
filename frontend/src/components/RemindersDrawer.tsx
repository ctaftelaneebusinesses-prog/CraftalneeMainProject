import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellOff, BellRing, Check, Mail, MonitorSmartphone, Send } from "lucide-react";
import { api } from "@/lib/api";
import { can, useSession } from "@/lib/session";
import type { EmailReminderSettings } from "@/lib/types";
import { Badge, Button, Field, Input, Toggle } from "@/components/ui/core";
import { Drawer } from "@/components/ui/overlay";
import { enablePopups, popupState, type PopupState } from "@/components/ReminderBell";

const EMPTY = { enabled: false, smtp_host: "", smtp_port: "587", smtp_user: "", smtp_password: "", smtp_from: "", app_url: "" };
const PRESETS = [
  { label: "Gmail", host: "smtp.gmail.com", port: "587" },
  { label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: "587" },
  { label: "Zoho", host: "smtp.zoho.in", port: "465" },
];

/** How follow-up reminders reach people: desktop pop-ups in this browser, and (settings area) reminder emails. */
export function RemindersDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const admin = can(user, "settings");
  const [popups, setPopups] = useState<PopupState>(popupState);
  const [form, setForm] = useState(EMPTY);

  const { data } = useQuery({
    queryKey: ["followup-email"], enabled: open && admin,
    queryFn: () => api.get<{ settings: EmailReminderSettings }>("/followups/email-settings"),
  });
  const st = data?.settings;
  useEffect(() => {
    if (st) setForm({ enabled: st.enabled, smtp_host: st.smtp_host ?? "", smtp_port: String(st.smtp_port), smtp_user: st.smtp_user ?? "",
      smtp_password: "", smtp_from: st.smtp_from ?? "", app_url: st.app_url });
  }, [st]);
  useEffect(() => { if (open) setPopups(popupState()); }, [open]);

  const save = useMutation({
    mutationFn: () => api.put<{ settings: EmailReminderSettings }>("/followups/email-settings", form),
    onSuccess: (r) => { qc.setQueryData(["followup-email"], r); toast.success(r.settings.enabled ? "Email reminders are on" : "Email settings saved"); },
  });
  const test = useMutation({
    mutationFn: () => api.post<{ sent_to: string }>("/followups/email-test", {}),
    onSuccess: (r) => toast.success(`Test email sent to ${r.sent_to}`),
  });
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const gmail = form.smtp_host.includes("gmail");

  return (
    <Drawer open={open} onClose={onClose} width={560} title="Follow-up reminders" subtitle="Get told when a follow-up's date and time arrive."
      footer={admin ? <><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" icon={<Check />} loading={save.isPending} onClick={() => save.mutate()}>Save email settings</Button></>
        : <Button onClick={onClose}>Close</Button>}>
      <div className="space-y-6">
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 mb-1.5"><MonitorSmartphone className="size-4 text-brand-300" /><h3 className="font-display font-semibold text-[15px]">Desktop pop-ups</h3>
            {popups === "on" && <Badge tone="good" dot className="ml-auto">On</Badge>}</div>
          <p className="text-[13px] text-fg-3 mb-3">A Windows notification and an in-app alert when a follow-up is due, while CraftLanee is open in a tab (it can be in the background). The bell at the top lists everything due.</p>
          {popups === "off" && <Button size="sm" variant="primary" icon={<BellRing />} onClick={async () => setPopups(await enablePopups())}>Turn on desktop pop-ups</Button>}
          {popups === "on" && <p className="text-[12.5px] text-fg-4">Turned on for this browser. Do the same on each computer you use.</p>}
          {popups === "blocked" && <p className="flex items-start gap-2 text-[13px] text-fg-2"><BellOff className="size-4 text-bad shrink-0 mt-0.5" />This browser blocked notifications for CraftLanee. Click the icon at the left of the address bar, set Notifications to Allow, then reload.</p>}
          {popups === "unsupported" && <p className="flex items-start gap-2 text-[13px] text-fg-2"><BellOff className="size-4 shrink-0 mt-0.5" />Browsers only allow pop-ups on https or on this computer (http://127.0.0.1:8080). In-app alerts and emails still work.</p>}
        </section>

        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 mb-1.5"><Mail className="size-4 text-brand-300" /><h3 className="font-display font-semibold text-[15px]">Email reminders</h3>
            {st && <Badge tone={st.enabled ? "good" : "neutral"} dot className="ml-auto">{st.enabled ? "On" : "Off"}</Badge>}</div>
          {!admin ? (
            <p className="text-[13px] text-fg-3">The server emails a reminder when a follow-up comes due, even if the app is closed. Someone with Settings access sets this up here.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-[13px] text-fg-3">The server sends one email when follow-ups come due, even if nobody has the app open. The server must be running.
                {st && <> Goes to: <span className="text-fg-2">{st.recipients.map((r) => r.email).join(", ") || "nobody yet"}</span> (everyone with follow-ups access).</>}</p>
              <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Send reminder emails" />
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => <button key={p.label} type="button" onClick={() => setForm({ ...form, smtp_host: p.host, smtp_port: p.port })}
                  className="h-7 px-2.5 rounded-lg border border-white/[0.08] text-[12px] text-fg-3 hover:text-fg transition-colors">{p.label}</button>)}
              </div>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Field label="Mail server (SMTP)"><Input value={form.smtp_host} onChange={set("smtp_host")} placeholder="smtp.gmail.com" /></Field>
                <Field label="Port"><Input value={form.smtp_port} onChange={set("smtp_port")} inputMode="numeric" /></Field>
              </div>
              <Field label="Username" hint="Usually your full email address."><Input value={form.smtp_user} onChange={set("smtp_user")} autoComplete="off" /></Field>
              <Field label="Password" hint={gmail ? "For Gmail, use an App password (Google Account → Security → 2-Step Verification → App passwords), not your normal password." : st?.password_set ? "Saved. Leave blank to keep it." : undefined}>
                <Input type="password" value={form.smtp_password} onChange={set("smtp_password")} autoComplete="new-password" placeholder={st?.password_set ? "••••••••" : ""} /></Field>
              <Field label="From address" optional hint="Defaults to the username."><Input value={form.smtp_from} onChange={set("smtp_from")} /></Field>
              <Field label="App link in emails" hint="Where the Open follow-ups button points."><Input value={form.app_url} onChange={set("app_url")} /></Field>
              <Button size="sm" icon={<Send />} loading={test.isPending} disabled={!st?.ready} onClick={() => test.mutate()}
                title={st?.ready ? undefined : "Save the settings first"}>Send me a test email</Button>
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
