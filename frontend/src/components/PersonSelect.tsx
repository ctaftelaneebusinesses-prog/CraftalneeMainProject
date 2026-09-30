import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Crown, Search } from "lucide-react";
import { cn } from "@/lib/format";
import type { EmployeeBrief } from "@/lib/types";
import { Avatar } from "@/components/ui/core";

/** Searchable single-person dropdown with avatars. `null` = the optional "none" option (e.g. reports to the founder). */
export function PersonSelect({ people, value, onChange, noneLabel, placeholder = "Select a person", exclude = [] }: {
  people: EmployeeBrief[]; value: number | null; onChange: (id: number | null) => void;
  noneLabel?: string; placeholder?: string; exclude?: number[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const selected = people.find((p) => p.id === value) ?? null;
  const list = people.filter((p) => !exclude.includes(p.id) && (!q || `${p.full_name} ${p.designation ?? ""} ${p.emp_code}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn("input flex items-center gap-2.5 text-left", open && "border-brand-400/70")}>
        {selected ? (<><Avatar person={selected} size={24} /><span className="flex-1 truncate">{selected.full_name}<span className="text-fg-4 text-[12.5px]"> · {selected.designation ?? "—"}</span></span></>)
          : value === null && noneLabel ? (<><span className="grid place-items-center size-6 rounded-full text-on-accent" style={{ background: "var(--grad)" }}><Crown className="size-3.5" /></span><span className="flex-1 truncate">{noneLabel}</span></>)
          : <span className="flex-1 text-fg-4">{placeholder}</span>}
        <ChevronDown className="size-4 text-fg-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute z-40 left-0 right-0 mt-1.5 glass panel p-1.5">
            <div className="relative mb-1.5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-fg-4" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input input-sm pl-8" />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {noneLabel && (
                <Row active={value === null} onClick={() => { onChange(null); setOpen(false); }}>
                  <span className="grid place-items-center size-7 rounded-full text-on-accent" style={{ background: "var(--grad)" }}><Crown className="size-3.5" /></span>
                  <span className="flex-1">{noneLabel}</span>
                </Row>
              )}
              {list.map((p) => (
                <Row key={p.id} active={p.id === value} onClick={() => { onChange(p.id); setOpen(false); }}>
                  <Avatar person={p} size={28} />
                  <span className="flex-1 min-w-0"><span className="block truncate">{p.full_name}</span><span className="block text-[11.5px] text-fg-4 truncate">{p.designation ?? "—"}</span></span>
                </Row>
              ))}
              {!list.length && !noneLabel && <div className="px-3 py-4 text-center text-[12.5px] text-fg-4">No one found</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors", active ? "bg-brand-500/12 text-fg" : "text-fg-2 hover:bg-white/[0.05]")}>
      {children}{active && <Check className="size-4 text-brand-300" />}
    </button>
  );
}
