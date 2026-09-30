import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { Button, Toggle } from "@/components/ui/core";
import { AuthLayout } from "./AuthLayout";

export default function Login() {
  const { session } = useSession();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ user: User }>("/auth/login", { email, password, remember });
      const next = params.get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : res.user.is_admin ? "/dashboard" : "/me";
      // Clean page load into the signed-in app: no stale state from the signed-out session can linger.
      // (Clearing the query cache in place detached the session observer and bounced users back to /login.)
      window.location.replace(target);
      return;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout company={session?.company?.company_name}>
      <h2 className="font-display text-[30px] font-bold tracking-tight">Welcome back</h2>
      <p className="text-fg-3 mt-2 mb-9">Sign in to continue to your workspace.</p>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="field-label">Email</label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-fg-4" />
            <input className="input pl-10 h-12" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@craftlanee.com" />
          </div>
        </div>
        <div>
          <label className="field-label">Password</label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-fg-4" />
            <input className="input pl-10 pr-11 h-12" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-fg-4 hover:text-fg" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <Toggle checked={remember} onChange={setRemember} label="Keep me signed in" />
        {error && <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-[13.5px] text-rose-200">{error}</div>}
        <Button variant="primary" type="submit" loading={busy} className="w-full h-12 text-[14.5px]">
          Sign in <ArrowRight />
        </Button>
      </form>
      <p className="mt-10 text-center text-[12.5px] text-fg-4">Forgot your password? Ask the founder to reset it from your profile.</p>
    </AuthLayout>
  );
}
