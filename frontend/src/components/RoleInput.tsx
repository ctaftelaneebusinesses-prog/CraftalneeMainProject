import { useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/format";

export const ROLE_SUGGESTIONS = [
  "CEO", "CTO", "COO", "Founder", "Co-founder", "HR", "HR Manager", "Project Manager", "Product Manager", "Team Lead",
  "Full Stack Developer", "Frontend Developer", "Backend Developer", "Software Engineer", "Mobile Developer",
  "UI/UX Designer", "Graphic Designer", "QA Engineer", "DevOps Engineer", "Data Analyst", "Business Analyst",
  "Marketing Executive", "Digital Marketer", "Sales Executive", "Content Writer", "Accountant", "Trainer", "Intern",
];

/** Multi-role picker: type + Enter, or pick a suggestion. The first role is the primary designation. */
export function RoleInput({ value, onChange, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const pool = Array.from(new Set([...suggestions, ...ROLE_SUGGESTIONS]));
  const lower = value.map((v) => v.toLowerCase());
  const needle = text.trim().toLowerCase();
  const matches = pool.filter((r) => !lower.includes(r.toLowerCase()) && (!needle || r.toLowerCase().includes(needle))).slice(0, 8);
  const exact = pool.some((r) => r.toLowerCase() === needle);

  const add = (r: string) => {
    const v = r.trim();
    if (v && !lower.includes(v.toLowerCase())) onChange([...value, v]);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && text.trim()) { e.preventDefault(); add(text); }
    if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };

  return (
    <div className="relative">
      <div className={cn("input h-auto min-h-[46px] flex flex-wrap items-center gap-1.5 py-1.5 px-2 cursor-text", open && "border-brand-400/70")}
        onClick={() => document.getElementById("role-input")?.focus()}>
        <AnimatePresence initial={false}>
          {value.map((r, i) => (
            <motion.span key={r} layout initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
              className={cn("inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-lg text-[12.5px] font-medium border",
                i === 0 ? "bg-brand-500/15 border-brand-500/35 text-brand-300" : "bg-white/[0.05] border-white/10 text-fg-2")}>
              {i === 0 && <span className="text-[9.5px] uppercase tracking-wider opacity-70">Primary</span>}
              {r}
              <button type="button" onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== r)); }}
                className="grid place-items-center size-5 rounded-md hover:bg-white/10" aria-label={`Remove ${r}`}><X className="size-3" /></button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input id="role-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value.length ? "Add another role…" : "e.g. Full Stack Developer, Project Manager, HR…"}
          className="flex-1 min-w-[160px] bg-transparent outline-none text-[14px] px-1.5 h-8 placeholder:text-fg-4" />
      </div>
      <AnimatePresence>
        {open && (matches.length > 0 || (needle && !exact)) && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute z-30 left-0 right-0 mt-1.5 glass panel p-1.5 max-h-64 overflow-y-auto">
            {needle && !exact && (
              <button type="button" onMouseDown={(e) => { e.preventDefault(); add(text); }}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-white/[0.06]">
                <Plus className="size-3.5 text-brand-300" /> Add "{text.trim()}"
              </button>
            )}
            {matches.map((r) => (
              <button key={r} type="button" onMouseDown={(e) => { e.preventDefault(); add(r); }}
                className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-fg-2 hover:bg-white/[0.06] hover:text-fg">{r}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
