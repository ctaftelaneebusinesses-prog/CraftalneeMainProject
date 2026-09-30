import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Avatar, Button, Card, CardHeader, Field, Input, PageHeader } from "@/components/ui/core";

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const LABELS = ["Too short", "Weak", "Okay", "Good", "Strong"];
const COLORS = ["#fb7185", "#fb7185", "#fbbf24", "#34d399", "#34d399"];

export default function Account() {
  const { user } = useSession();
  const [f, setF] = useState({ current: "", new: "", confirm: "" });
  const m = useMutation({
    mutationFn: () => api.post("/auth/password", { current: f.current, new: f.new }),
    onSuccess: () => { toast.success("Password updated"); setF({ current: "", new: "", confirm: "" }); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (f.new !== f.confirm) return toast.error("New passwords do not match.");
    m.mutate();
  };
  const st = strength(f.new);

  return (
    <>
      <PageHeader eyebrow="Account" title="Your account" subtitle="Manage your sign-in details." />
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start max-w-[980px]">
        <Card className="p-6 text-center">
          <div className="flex justify-center"><Avatar person={user?.employee ?? { initials: (user?.name ?? "?")[0].toUpperCase(), id: user?.id }} size={84} ring /></div>
          <div className="font-display font-semibold text-[18px] mt-4">{user?.name}</div>
          <div className="text-fg-3 text-[13px]">{user?.email}</div>
          <div className="mt-4 inline-flex items-center gap-2 text-[12.5px] text-good"><ShieldCheck className="size-4" />{user?.is_owner ? "Founder · full access" : user?.is_admin ? `Admin · ${user.full_access ? "full access" : `${user.permissions.length} area${user.permissions.length === 1 ? "" : "s"}`} (granted by founder)` : "Employee · own data only"}</div>
        </Card>
        <Card>
          <CardHeader icon={<KeyRound />} title="Change password" subtitle="Use at least 8 characters." />
          <form onSubmit={submit} className="px-6 pb-6 space-y-4">
            <Field label="Current password"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" required /></Field>
            <Field label="New password">
              <Input type="password" value={f.new} onChange={(e) => setF({ ...f, new: e.target.value })} minLength={8} autoComplete="new-password" required />
              {f.new && (
                <div className="mt-2.5 flex items-center gap-3">
                  <div className="flex-1 grid grid-cols-4 gap-1.5">{[0, 1, 2, 3].map((i) => <span key={i} className="h-1.5 rounded-full transition-colors" style={{ background: i < st ? COLORS[st] : "rgba(255,255,255,0.08)" }} />)}</div>
                  <span className="text-[12px]" style={{ color: COLORS[st] }}>{LABELS[st]}</span>
                </div>
              )}
            </Field>
            <Field label="Confirm new password" error={f.confirm && f.confirm !== f.new ? "Passwords don't match" : undefined}>
              <Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} minLength={8} autoComplete="new-password" required />
            </Field>
            <div className="flex justify-end pt-2"><Button variant="primary" type="submit" loading={m.isPending}>Update password</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
