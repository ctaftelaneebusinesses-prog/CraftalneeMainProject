import { useState } from "react";
import { ChevronRight, Users } from "lucide-react";
import { useEmployeeOptions } from "@/lib/hooks";
import { Avatar, Button, EmptyState, SearchInput, Skeleton, StatusBadge } from "@/components/ui/core";
import { Modal } from "@/components/ui/overlay";

export function EmployeePicker({ open, onClose, onPick, title = "Select employee" }: { open: boolean; onClose: () => void; onPick: (id: number) => void; title?: string }) {
  const { data, isLoading } = useEmployeeOptions();
  const [q, setQ] = useState("");
  const list = (data?.employees ?? []).filter((e) => !q || `${e.full_name} ${e.emp_code} ${e.designation}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle="Their details will be filled in automatically." width={560}>
      <SearchInput value={q} onChange={setQ} placeholder="Search employees…" className="mb-4" />
      <div className="-mx-2 max-h-[52vh] overflow-y-auto">
        {isLoading ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 mx-2 mb-2" />)
          : list.length === 0 ? <EmptyState icon={<Users />} title="No employees" text="Add an employee first." action={<Button to="/employees/new">Add employee</Button>} />
          : list.map((e) => (
            <button key={e.id} onClick={() => onPick(e.id)} className="group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.05] transition-colors">
              <Avatar person={e} size={38} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{e.full_name} <span className="font-mono text-[11.5px] text-fg-4 ml-1">{e.emp_code}</span></div>
                <div className="text-[12.5px] text-fg-3 truncate">{e.designation ?? "—"}{e.department && ` · ${e.department}`}</div>
              </div>
              {e.status !== "active" && <StatusBadge status={e.status} />}
              <ChevronRight className="size-4 text-fg-4 group-hover:text-fg group-hover:translate-x-0.5 transition-all" />
            </button>
          ))}
      </div>
    </Modal>
  );
}
