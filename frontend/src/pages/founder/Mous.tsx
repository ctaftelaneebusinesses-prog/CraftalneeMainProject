import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CalendarRange, Handshake, Plus, UserRound } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDate, today } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { Mou } from "@/lib/types";
import { Badge, Button, Card, EmptyState, FileActions, PageHeader, SearchInput, Segmented, Skeleton } from "@/components/ui/core";
import { DeleteDocButton } from "@/components/DeleteDocButton";

export function mouStatus(m: Mou) {
  if (m.archived) return <Badge>Archived</Badge>;
  if (m.end_date && m.end_date < today()) return <Badge tone="warn" dot>Expired</Badge>;
  if (m.start_date && m.start_date > today()) return <Badge tone="info" dot>Upcoming</Badge>;
  return <Badge tone="good" dot>Active</Badge>;
}

function progress(m: Mou) {
  if (!m.start_date || !m.end_date) return null;
  const s = new Date(m.start_date).getTime(), e = new Date(m.end_date).getTime(), n = Date.now();
  return Math.max(0, Math.min(100, ((n - s) / Math.max(1, e - s)) * 100));
}

export default function Mous() {
  const [show, setShow] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, isLoading } = useQuery({
    queryKey: ["mous", show, dq],
    queryFn: () => api.get<{ mous: Mou[] }>(`/mous${qs({ show: show === "archived" ? "archived" : "", q: dq })}`),
    placeholderData: keepPreviousData,
  });
  const rows = data?.mous ?? [];

  return (
    <>
      <PageHeader eyebrow="Documents" title="Memoranda of Understanding"
        subtitle={<>Agreements with partner organisations · <span className="font-mono text-fg-2">CL-MOU-YYYY-NNNN</span></>}
        actions={<Button variant="primary" icon={<Plus />} to="/mous/new">New MOU</Button>} />
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Segmented layoutId="mou-show" value={show} onChange={setShow} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search number, party, contact…" className="w-full sm:w-[300px]" />
      </div>

      {isLoading ? <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}</div>
        : rows.length === 0 ? (
          <Card><EmptyState icon={<Handshake />} title={q || show === "archived" ? "Nothing found" : "No MOUs yet"}
            text={q || show === "archived" ? undefined : "Create one and a signature-ready PDF is generated automatically."}
            action={!q && show === "active" && <Button variant="primary" icon={<Plus />} to="/mous/new">New MOU</Button>} /></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((m, i) => {
              const p = progress(m);
              return (
                <motion.div key={m.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <Card hover className="group relative h-full overflow-hidden p-5 flex flex-col">
                    <div className="absolute -right-10 -top-10 size-32 rounded-full bg-flame-500/15 blur-2xl opacity-60 group-hover:opacity-100 transition-opacity" />
                    <div className="relative flex items-start justify-between gap-3">
                      <span className="grid place-items-center size-11 rounded-xl bg-gradient-to-br from-flame-500/25 to-white/[0.02] border border-white/[0.08] text-flame-400"><Handshake className="size-5" /></span>
                      {mouStatus(m)}
                    </div>
                    <Link to={`/mous/${m.id}`} className="relative mt-4 font-display font-semibold text-[16.5px] leading-snug hover:text-brand-300 transition-colors">{m.party_name}</Link>
                    <div className="relative font-mono text-[11.5px] text-fg-4 mt-1">{m.number}</div>
                    {m.purpose && <p className="relative mt-3 text-[13px] text-fg-3 line-clamp-2">{m.purpose}</p>}
                    <div className="relative mt-auto pt-5 space-y-2 text-[12.5px] text-fg-3">
                      <div className="flex items-center gap-2"><UserRound className="size-3.5" />{m.contact_person ?? "—"}</div>
                      <div className="flex items-center gap-2"><CalendarRange className="size-3.5" />{fmtDate(m.start_date)} → {fmtDate(m.end_date)}</div>
                      {p !== null && !m.archived && (
                        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden mt-2">
                          <motion.div className="h-full rounded-full" style={{ background: "var(--grad)" }} initial={{ width: 0 }} animate={{ width: `${p}%` }} transition={{ duration: 0.9, delay: 0.2 }} />
                        </div>
                      )}
                    </div>
                    <div className="relative flex items-center justify-between mt-4 pt-4 border-t divider">
                      <Button size="sm" variant="ghost" to={`/mous/${m.id}`}>Open</Button>
                      <div className="flex items-center gap-1"><FileActions url={m.file_url} /><DeleteDocButton kind="mou" id={m.id} number={m.number} label="MOU" /></div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
    </>
  );
}
