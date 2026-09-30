import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Receipt, Wallet } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDate, inr, monthLabel } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { Payslip } from "@/lib/types";
import { Button, Card, EmptyState, FileActions, PageHeader, Person, SearchInput, Select, Skeleton } from "@/components/ui/core";
import { DocIcon } from "@/components/DocRow";

export default function Payslips() {
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const dq = useDebounced(q);
  const { data, isLoading } = useQuery({
    queryKey: ["payslips", month, dq],
    queryFn: () => api.get<{ payslips: Payslip[]; months: { month: string; label: string }[] }>(`/payslips${qs({ month, q: dq })}`),
    placeholderData: keepPreviousData,
  });
  const rows = data?.payslips ?? [];
  const total = rows.reduce((s, p) => s + p.net, 0);

  return (
    <>
      <PageHeader eyebrow="Payroll" title="Payslips" subtitle={<>Generated from finalised payroll · <span className="font-mono text-fg-2">CL-PS-YYYY-NNNN</span></>}
        actions={<Button icon={<Wallet />} to="/payroll">Go to payroll</Button>} />
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Select className="input-sm h-[38px] w-[200px]" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="All months"
          options={(data?.months ?? []).map((m) => ({ value: m.month, label: m.label }))} />
        {rows.length > 0 && <span className="text-[13px] text-fg-3">{rows.length} payslips · <span className="tnum text-fg-2">{inr(total)}</span> net</span>}
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search number or employee…" className="w-full sm:w-[300px]" />
      </div>
      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : rows.length === 0 ? <EmptyState icon={<Receipt />} title="No payslips found" text="Finalise a payroll month to generate payslips." action={<Button to="/payroll">Go to payroll</Button>} />
          : (
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>Payslip</th><th>Employee</th><th>Month</th><th className="text-right">Net salary</th><th>Generated</th><th /></tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.id}>
                  <td><div className="flex items-center gap-3"><DocIcon kind="payslip" size={34} /><span className="font-mono text-[12.5px]">{p.number}</span></div></td>
                  <td>{p.employee && <Person e={p.employee} to={`/employees/${p.employee_id}`} sub={p.employee.emp_code} size={32} />}</td>
                  <td className="text-fg-2">{monthLabel(p.month)}</td>
                  <td className="text-right tnum font-semibold">{inr(p.net)}</td>
                  <td className="text-fg-3">{fmtDate(p.updated_at)}</td>
                  <td><div className="flex justify-end"><FileActions url={p.file_url} /></div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>
    </>
  );
}
