import type { ReactNode } from "react";
import { motion } from "motion/react";
import { FileSignature, Receipt, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
import { Ambient } from "@/components/layout/AppShell";
import { useTheme } from "@/lib/theme";
import { LoginShowcase } from "@/components/LoginShowcase";

const FEATURES = [
  { icon: Users, label: "People" },
  { icon: FileSignature, label: "Letters & MOUs" },
  { icon: Wallet, label: "Payroll" },
  { icon: Receipt, label: "Payslips" },
];

/** The CraftLanee wordmark straight on the background: dark lettering in light mode, light lettering in dark mode. */
function Wordmark({ alt, className }: { alt: string; className: string }) {
  const { theme } = useTheme();
  return <img src={theme === "dark" ? "/brand/craftlanee-logo-light.png" : "/brand/craftlanee-logo.png"} alt={alt} className={className} />;
}

export function AuthLayout({ children, company }: { children: ReactNode; company?: string }) {
  return (
    <div className="relative min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <Ambient />
      {/* showcase */}
      <section className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden border-r border-white/[0.06]">
        <div className="flex flex-col items-start gap-2.5">
          <Wordmark alt={company ?? "CraftLanee"} className="h-10 w-auto" />
          <div className="pl-[3px] text-[11px] uppercase tracking-[0.16em] text-fg-4">Company OS</div>
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

          {/* the product at a glance: modules orbiting the mark + a live activity feed */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
            <LoginShowcase />
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
          <Wordmark alt={company ?? "CraftLanee"} className="lg:hidden mb-8 h-8 w-auto" />
          {children}
        </motion.div>
      </section>
    </div>
  );
}
