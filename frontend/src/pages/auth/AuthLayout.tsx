import type { ReactNode } from "react";
import { motion } from "motion/react";
import { FileSignature, Receipt, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
import { Ambient } from "@/components/layout/AppShell";

const FEATURES = [
  { icon: Users, label: "People" },
  { icon: FileSignature, label: "Letters & MOUs" },
  { icon: Wallet, label: "Payroll" },
  { icon: Receipt, label: "Payslips" },
];

export function AuthLayout({ children, company }: { children: ReactNode; company?: string }) {
  return (
    <div className="relative min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <Ambient />
      {/* showcase */}
      <section className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden border-r border-white/[0.06]">
        <div className="flex flex-col items-start gap-2">
          {/* Wordmark on a white card (as in the sidebar) so its dark lettering reads in both themes. */}
          <span className="rounded-2xl bg-[#fff] px-4 py-3 shadow-[0_10px_30px_-10px_rgba(124,92,255,0.55)]">
            <img src="/brand/craftlanee-logo.png" alt={company ?? "CraftLanee"} className="h-9 w-auto" />
          </span>
          <div className="pl-1 text-[11px] uppercase tracking-[0.16em] text-fg-4">Company OS</div>
        </div>

        <div className="relative">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[12px] text-fg-2 mb-6">
              <Sparkles className="size-3.5 text-flame-400" /> Built for founders who move fast
            </div>
            <h1 className="font-display text-[52px] leading-[1.02] font-extrabold tracking-[-0.035em] max-w-[560px]">
              Run your company<br />with <span className="text-grad">clarity.</span>
            </h1>
            <p className="mt-5 text-[16px] text-fg-3 max-w-[460px] leading-relaxed">
              Team, documents, payroll and finances — beautifully organised in one calm, private workspace.
            </p>
          </motion.div>

          {/* floating preview card */}
          <motion.div initial={{ opacity: 0, y: 30, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: -2 }} transition={{ delay: 0.25, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="mt-12 w-[380px] glass glow-border p-5 bg-ink-850/80">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Current balance</span>
              <span className="badge badge-good"><span className="dot" />Healthy</span>
            </div>
            <div className="mt-3 font-display text-[34px] font-bold tnum">₹4,23,300</div>
            <div className="mt-4 flex items-end gap-1.5 h-14">
              {[38, 52, 44, 68, 58, 82, 74, 96].map((h, i) => (
                <motion.span key={i} className="flex-1 rounded-t-md" style={{ background: i === 7 ? "var(--grad)" : "rgba(255,255,255,0.08)" }}
                  initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: 0.5 + i * 0.06, duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
              ))}
            </div>
          </motion.div>
        </div>

        <div className="flex items-center gap-6 text-fg-4 text-[12.5px]">
          {FEATURES.map((f) => <span key={f.label} className="flex items-center gap-2"><f.icon className="size-4" />{f.label}</span>)}
          <span className="ml-auto flex items-center gap-2"><ShieldCheck className="size-4 text-good" /> Private & secure</span>
        </div>
      </section>

      {/* form */}
      <section className="relative flex items-center justify-center p-6 sm:p-12">
        <motion.div className="w-full max-w-[400px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}>
          <span className="lg:hidden mb-8 inline-block rounded-2xl bg-[#fff] px-3.5 py-2.5 shadow-[0_10px_30px_-10px_rgba(124,92,255,0.55)]">
            <img src="/brand/craftlanee-logo.png" alt={company ?? "CraftLanee"} className="h-7 w-auto" />
          </span>
          {children}
        </motion.div>
      </section>
    </div>
  );
}
