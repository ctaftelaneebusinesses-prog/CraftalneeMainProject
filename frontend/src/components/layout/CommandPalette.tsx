import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, CornerDownLeft, FileText, Loader2, Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import { inr } from "@/lib/format";
import type { DocItem, EmployeeBrief, Expense, Income } from "@/lib/types";
import { Avatar } from "@/components/ui/core";
import { useSession } from "@/lib/session";
import { FOUNDER_NAV, QUICK_ACTIONS, allowed } from "./nav";

interface SearchResults {
  employees: EmployeeBrief[];
  documents: DocItem[];
  income: Income[];
  expenses: Expense[];
}

function useDebounced<T>(value: T, ms = 220) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useSession();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const { data, isFetching } = useQuery({
    queryKey: ["search", dq],
    queryFn: () => api.get<{ results: SearchResults }>(`/search${qs({ q: dq })}`),
    enabled: open && dq.length >= 2,
  });
  useEffect(() => { if (!open) setQ(""); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  const go = (to: string) => { onClose(); navigate(to); };
  const needle = q.trim().toLowerCase();
  const pages = useMemo(() => allowed(user, FOUNDER_NAV.flatMap((g) => g.items))
    .filter((i) => !needle || i.label.toLowerCase().includes(needle)), [needle, user]);
  const actions = allowed(user, QUICK_ACTIONS).filter((a) => !needle || a.label.toLowerCase().includes(needle));
  const r = dq.length >= 2 ? data?.results : undefined;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] px-4">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div className="relative w-full max-w-[640px] glass glow-border bg-ink-850/95 overflow-hidden"
            initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 480, damping: 36 }}>
            <Command shouldFilter={false} loop label="Command palette">
              <div className="flex items-center gap-3 px-5 border-b divider">
                <Search className="size-[18px] text-fg-3" />
                <Command.Input autoFocus value={q} onValueChange={setQ}
                  placeholder="Search employees, documents, payslips, income… or jump anywhere"
                  className="flex-1 h-[58px] bg-transparent outline-none text-[15px] placeholder:text-fg-4" />
                {isFetching && <Loader2 className="size-4 animate-spin text-fg-3" />}
                <kbd className="text-[11px] text-fg-4 border border-white/10 rounded-md px-1.5 py-0.5">ESC</kbd>
              </div>
              <Command.List className="max-h-[420px] overflow-y-auto p-2">
                <Command.Empty>{dq.length >= 2 && !isFetching ? `No results for “${q}”.` : "Type to search…"}</Command.Empty>

                {r && r.employees.length > 0 && (
                  <Command.Group heading="Employees">
                    {r.employees.map((e) => (
                      <Command.Item key={`e${e.id}`} value={`e${e.id}`} onSelect={() => go(`/employees/${e.id}`)}>
                        <Avatar person={e} size={26} />
                        <span className="flex-1 truncate">{e.full_name}</span>
                        <span className="text-[12px] text-fg-4 font-mono">{e.emp_code}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {r && r.documents.length > 0 && (
                  <Command.Group heading="Documents">
                    {r.documents.map((d) => (
                      <Command.Item key={`d${d.kind}${d.id}`} value={`d${d.kind}${d.id}`}
                        onSelect={() => d.kind === "mou" ? go(`/mous/${d.id}`) : d.employee_id ? go(`/employees/${d.employee_id}`) : window.open(d.file_url)}>
                        <FileText className="text-brand-300" />
                        <span className="flex-1 truncate">{d.number} <span className="text-fg-4">· {d.title}</span></span>
                        <span className="text-[11.5px] text-fg-4">{d.type}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {r && r.income.length > 0 && (
                  <Command.Group heading="Income">
                    {r.income.map((x) => (
                      <Command.Item key={`i${x.id}`} value={`i${x.id}`} onSelect={() => go(`/finance/income?q=${encodeURIComponent(x.source)}`)}>
                        <ArrowUpRight className="text-good" />
                        <span className="flex-1 truncate">{x.source}{x.client && <span className="text-fg-4"> · {x.client}</span>}</span>
                        <span className="tnum text-fg-2">{inr(x.amount)}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {r && r.expenses.length > 0 && (
                  <Command.Group heading="Expenses">
                    {r.expenses.map((x) => (
                      <Command.Item key={`x${x.id}`} value={`x${x.id}`} onSelect={() => go(`/finance/expenses?q=${encodeURIComponent(x.description)}`)}>
                        <ArrowDownRight className="text-bad" />
                        <span className="flex-1 truncate">{x.description}<span className="text-fg-4"> · {x.category}</span></span>
                        <span className="tnum text-fg-2">{inr(x.amount)}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {actions.length > 0 && (
                  <Command.Group heading="Quick actions">
                    {actions.map((a) => (
                      <Command.Item key={a.to} value={`a${a.to}`} onSelect={() => go(a.to)}>
                        <a.icon className="text-flame-400" /> <span className="flex-1">{a.label}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {pages.length > 0 && (
                  <Command.Group heading="Go to">
                    {pages.map((p) => (
                      <Command.Item key={p.to} value={`p${p.to}`} onSelect={() => go(p.to)}>
                        <p.icon /> <span className="flex-1">{p.label}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
              <div className="flex items-center gap-4 px-5 h-10 border-t divider text-[11.5px] text-fg-4">
                <span className="flex items-center gap-1.5"><CornerDownLeft className="size-3" /> select</span>
                <span>↑↓ navigate</span>
                <span className="ml-auto">CraftLanee</span>
              </div>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
