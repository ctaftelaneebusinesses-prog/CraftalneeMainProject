import { motion } from "motion/react";
import { Briefcase, Clock3, FileSignature, GraduationCap, Laptop, Sprout } from "lucide-react";
import { cn } from "@/lib/format";

export const EMPLOYMENT_META: Record<string, { icon: typeof Briefcase; hint: string; tone: string }> = {
  "Full-time": { icon: Briefcase, hint: "Permanent, salaried", tone: "text-brand-300" },
  "Part-time": { icon: Clock3, hint: "Reduced hours", tone: "text-info" },
  Contract: { icon: FileSignature, hint: "Fixed term", tone: "text-flame-400" },
  Freelancer: { icon: Laptop, hint: "Project based", tone: "text-warn" },
  Intern: { icon: GraduationCap, hint: "Stipend · internship", tone: "text-good" },
  Trainee: { icon: Sprout, hint: "Stipend · training", tone: "text-good" },
};

export function EmploymentTypePicker({ value, onChange, types }: { value: string; onChange: (v: string) => void; types: string[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {types.map((t) => {
        const m = EMPLOYMENT_META[t] ?? EMPLOYMENT_META["Full-time"];
        const on = value === t;
        return (
          <button key={t} type="button" onClick={() => onChange(t)}
            className={cn("relative flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all",
              on ? "border-brand-400/60 bg-brand-500/[0.08]" : "border-white/[0.08] bg-white/[0.02] hover:border-white/20")}>
            {on && <motion.span layoutId="etype" className="absolute inset-0 rounded-xl ring-1 ring-brand-400/50" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className={cn("grid place-items-center size-9 rounded-lg bg-white/[0.05]", m.tone)}><m.icon className="size-[18px]" /></span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold text-fg">{t}</span>
              <span className="block text-[11.5px] text-fg-4 truncate">{m.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
