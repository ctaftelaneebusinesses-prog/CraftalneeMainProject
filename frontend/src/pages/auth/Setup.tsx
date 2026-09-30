import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Rocket } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Company, User } from "@/lib/types";
import { Button, Field, Input } from "@/components/ui/core";
import { AuthLayout } from "./AuthLayout";

export default function Setup() {
  const { session, setSession } = useSession();
  const needsCode = !!session?.setup_code_required;
  const navigate = useNavigate();
  const [f, setF] = useState({ setup_code: "", company_name: "CraftLanee", name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError("Passwords do not match.");
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ user: User; company: Company; csrf: string }>("/auth/setup", f);
      setSession({ user: res.user, company: res.company, setup_required: false, csrf: res.csrf });
      navigate("/settings?welcome=1", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-[12px] text-brand-300 mb-5">
        <Rocket className="size-3.5" /> First-time setup
      </div>
      <h2 className="font-display text-[30px] font-bold tracking-tight">Create your workspace</h2>
      <p className="text-fg-3 mt-2 mb-8">You'll be the founder with full access. Takes 20 seconds.</p>
      <form onSubmit={submit} className="space-y-4">
        {needsCode && (
          <Field label="Setup code" hint="The CRAFTLANEE_SETUP_CODE value set on the server. Only you should have it.">
            <Input value={f.setup_code} onChange={set("setup_code")} required autoFocus autoComplete="off" className="font-mono" />
          </Field>
        )}
        <Field label="Company name"><Input value={f.company_name} onChange={set("company_name")} required /></Field>
        <Field label="Your full name"><Input value={f.name} onChange={set("name")} required autoFocus={!needsCode} /></Field>
        <Field label="Email (used to sign in)"><Input type="email" value={f.email} onChange={set("email")} autoComplete="username" required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password"><Input type="password" value={f.password} onChange={set("password")} minLength={8} autoComplete="new-password" required /></Field>
          <Field label="Confirm"><Input type="password" value={f.confirm} onChange={set("confirm")} minLength={8} autoComplete="new-password" required /></Field>
        </div>
        {error && <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-[13.5px] text-rose-200">{error}</div>}
        <Button variant="primary" type="submit" loading={busy} className="w-full h-12 mt-2">Launch workspace</Button>
      </form>
    </AuthLayout>
  );
}
