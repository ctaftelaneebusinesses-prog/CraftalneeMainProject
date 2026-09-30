import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Crown, GitBranch, Hand, ListTodo, Maximize2, Minus, Network, Plane, Plus, ShieldCheck, Users } from "lucide-react";
import { api } from "@/lib/api";
import { cn, fmtDate } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import type { OrgNode } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, PageSkeleton, SearchInput } from "@/components/ui/core";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { RoleChips } from "@/pages/founder/Employees";

interface OrgData { founder: { name: string; title: string; company: string; logo_url: string | null }; nodes: OrgNode[]; can_edit: boolean }

export default function TeamTree() {
  const { user } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgData>("/org") });
  const [zoom, setZoom] = useState(1);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropOn, setDropOn] = useState<number | "founder" | null>(null);
  const [person, setPerson] = useState<OrgNode | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  const move = useMutation({
    mutationFn: ({ id, manager_id }: { id: number; manager_id: number | null }) => api.put(`/org/${id}`, { manager_id }),
    onSuccess: () => { ["org", "employees", "employee"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Reporting line updated"); },
  });

  const { children, byId, founderKids, peers, stats } = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const children = new Map<number, OrgNode[]>();
    nodes.forEach((n) => { if (n.manager_id && byId.has(n.manager_id)) children.set(n.manager_id, [...(children.get(n.manager_id) ?? []), n]); });
    const roots = nodes.filter((n) => !n.manager_id || !byId.has(n.manager_id));
    const peers = roots.filter((n) => n.is_admin);
    const founderKids = roots.filter((n) => !n.is_admin);
    const depth = (id: number): number => 1 + Math.max(0, ...(children.get(id) ?? []).map((c) => depth(c.id)));
    const stats = {
      people: nodes.length, admins: nodes.filter((n) => n.is_admin).length,
      leaders: Array.from(children.keys()).length,
      levels: nodes.length ? 1 + Math.max(0, ...roots.map((r) => depth(r.id))) : 1,
      away: nodes.filter((n) => n.on_leave).length,
    };
    return { children, byId, founderKids, peers, stats };
  }, [data]);

  /** Scale the chart so the whole team fits the viewport (never above 100%), then centre it. */
  const fit = useCallback(() => {
    const vp = viewport.current, el = content.current;
    if (!vp || !el) return;
    const natural = el.scrollWidth / (Number(el.style.zoom) || 1);
    const z = Math.max(0.45, Math.min(1, (vp.clientWidth - 24) / natural));
    setZoom(+z.toFixed(2));
    requestAnimationFrame(() => { vp.scrollLeft = (vp.scrollWidth - vp.clientWidth) / 2; vp.scrollTop = 0; });
  }, []);
  useEffect(() => {
    if (data && !fitted.current) { fitted.current = true; requestAnimationFrame(fit); }
  }, [data, fit]);

  if (isLoading || !data) return <PageSkeleton />;
  const canEdit = data.can_edit;
  const match = (n: OrgNode) => !q || `${n.full_name} ${n.roles.join(" ")} ${n.department ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const isDescendant = (id: number, of: number): boolean => (children.get(of) ?? []).some((c) => c.id === id || isDescendant(id, c.id));

  const drop = async (targetId: number | null) => {
    const id = dragId;
    setDragId(null); setDropOn(null);
    if (!id || id === targetId) return;
    const n = byId.get(id)!;
    if ((n.manager_id ?? null) === targetId) return;
    if (targetId && isDescendant(targetId, id)) { toast.error("Can't move someone under their own team member."); return; }
    const target = targetId ? byId.get(targetId)!.full_name : data.founder.name;
    if (await confirm({ title: `Move ${n.full_name}?`, message: <>They will report to <b>{target}</b>. Their team moves with them.</>, confirmText: "Move" })) {
      move.mutate({ id, manager_id: targetId });
    }
  };

  const toggle = (id: number) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const renderNode = (n: OrgNode, level = 1): React.ReactNode => {
    const kids = children.get(n.id) ?? [];
    const open = !collapsed.has(n.id);
    return (
      <li key={n.id}>
        <span className="tree-stem" />
        <NodeCard n={n} level={level} dim={!match(n)} highlight={!!q && match(n)} kids={kids.length} open={open} onToggle={() => toggle(n.id)}
          draggable={canEdit} dropping={dropOn === n.id}
          onDragStart={() => setDragId(n.id)} onDragOver={() => dragId && dragId !== n.id && setDropOn(n.id)} onDragLeave={() => setDropOn((d) => (d === n.id ? null : d))}
          onDrop={() => drop(n.id)} onOpen={() => (can(user, "employees") ? navigate(`/employees/${n.id}`) : setPerson(n))} />
        {kids.length > 0 && open && <ul>{kids.map((k) => renderNode(k, level + 1))}</ul>}
      </li>
    );
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-node]") || !viewport.current) return;
    pan.current = { x: e.clientX, y: e.clientY, sl: viewport.current.scrollLeft, st: viewport.current.scrollTop };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pan.current || !viewport.current) return;
    viewport.current.scrollLeft = pan.current.sl - (e.clientX - pan.current.x);
    viewport.current.scrollTop = pan.current.st - (e.clientY - pan.current.y);
  };

  return (
    <>
      <PageHeader eyebrow="Team" title="Team tree" subtitle={canEdit ? "Drag a person onto someone else to change who they report to. Everyone can view this chart." : "Who works with whom. Only the founder and admins can change the structure."} />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {[
          { icon: Users, label: "People", v: stats.people + 1 },
          { icon: ShieldCheck, label: "Admins", v: stats.admins },
          { icon: GitBranch, label: "Team leads", v: stats.leaders },
          { icon: Network, label: "Levels", v: stats.levels },
          { icon: Plane, label: "Away today", v: stats.away },
        ].map((s) => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <span className="grid place-items-center size-9 rounded-xl bg-brand-500/12 text-brand-300"><s.icon className="size-4" /></span>
            <div><div className="font-display font-bold text-[20px] leading-none tnum">{s.v}</div><div className="text-[11.5px] text-fg-4 mt-1">{s.label}</div></div>
          </Card>
        ))}
      </div>

      <Card className="relative overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b divider">
          <SearchInput value={q} onChange={setQ} placeholder="Find a person or role…" className="w-full sm:w-[260px]" />
          <div className="flex-1" />
          <span className="hidden md:flex items-center gap-1.5 text-[12px] text-fg-4 mr-2"><Hand className="size-3.5" /> Drag the background to pan</span>
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>Expand all</Button>
          <div className="flex items-center rounded-xl border border-white/[0.08] bg-white/[0.03] p-0.5">
            <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} className="grid place-items-center size-8 rounded-lg text-fg-3 hover:text-fg hover:bg-white/[0.06]" aria-label="Zoom out"><Minus className="size-4" /></button>
            <span className="w-12 text-center text-[12px] tnum text-fg-2">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))} className="grid place-items-center size-8 rounded-lg text-fg-3 hover:text-fg hover:bg-white/[0.06]" aria-label="Zoom in"><Plus className="size-4" /></button>
            <button onClick={fit} title="Fit to screen" className="grid place-items-center size-8 rounded-lg text-fg-3 hover:text-fg hover:bg-white/[0.06]" aria-label="Fit to screen"><Maximize2 className="size-3.5" /></button>
          </div>
        </div>
        <div ref={viewport} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { pan.current = null; }}
          className="relative overflow-auto h-[68vh] cursor-grab active:cursor-grabbing"
          style={{ backgroundImage: "radial-gradient(rgb(var(--ov) / 0.08) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
          <div ref={content} className="inline-block min-w-full p-10" style={{ zoom }}>
            {data.nodes.length === 0 ? <EmptyState icon={<Network />} title="No team yet" text="Add employees and choose who they report to." /> : (
              <div className="tree flex justify-center">
                <ul>
                  <li>
                    <FounderCard f={data.founder} dropping={dropOn === "founder"} canDrop={canEdit && !!dragId}
                      onDragOver={() => dragId && setDropOn("founder")} onDragLeave={() => setDropOn((d) => (d === "founder" ? null : d))} onDrop={() => drop(null)} />
                    {founderKids.length > 0 && <ul>{founderKids.map((k) => renderNode(k))}</ul>}
                  </li>
                  {peers.map((p) => renderNode(p, 0))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Modal open={!!person} onClose={() => setPerson(null)} title={person?.full_name ?? ""} subtitle={person?.department ?? undefined} width={440}>
        {person && (
          <div className="space-y-4">
            <div className="flex items-center gap-4"><Avatar person={person} size={64} ring />
              <div><RoleChips roles={person.roles} max={5} /><div className="text-[12.5px] text-fg-3 mt-1.5">{person.employment_type} · joined {fmtDate(person.joining_date)}</div></div></div>
            <div className="text-[13px] text-fg-2">Reports to <b>{person.manager_id ? byId.get(person.manager_id)?.full_name : data.founder.name}</b>
              {(children.get(person.id)?.length ?? 0) > 0 && <> · leads <b>{children.get(person.id)!.length}</b> {children.get(person.id)!.length === 1 ? "person" : "people"}</>}</div>
            {person.on_leave && <Badge tone="warn" dot>On leave today</Badge>}
          </div>
        )}
      </Modal>
    </>
  );
}

function FounderCard({ f, dropping, canDrop, onDragOver, onDragLeave, onDrop }: { f: OrgData["founder"]; dropping: boolean; canDrop: boolean; onDragOver: () => void; onDragLeave: () => void; onDrop: () => void }) {
  return (
    <div data-node onDragOver={(e) => { if (canDrop) { e.preventDefault(); onDragOver(); } }} onDragLeave={onDragLeave} onDrop={(e) => { e.preventDefault(); onDrop(); }}>
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
      className={cn("relative w-[240px] rounded-2xl p-[1.5px] transition-transform", dropping && "scale-105")} style={{ background: "var(--grad)" }}>
      <div className="rounded-[15px] panel px-4 py-4 text-center">
        <div className="mx-auto grid place-items-center size-14 rounded-2xl text-on-accent shadow-[0_10px_30px_-8px_rgba(124,92,255,0.8)]" style={{ background: "var(--grad)" }}><Crown className="size-6" /></div>
        <div className="font-display font-bold text-[16px] mt-3">{f.name}</div>
        <div className="text-[12.5px] text-fg-3">{f.title}</div>
        <Badge tone="brand" className="mt-2.5">Founder · {f.company}</Badge>
      </div>
    </motion.div>
    </div>
  );
}

function NodeCard({ n, level, dim, highlight, kids, open, onToggle, draggable, dropping, onDragStart, onDragOver, onDragLeave, onDrop, onOpen }: {
  n: OrgNode; level: number; dim: boolean; highlight: boolean; kids: number; open: boolean; onToggle: () => void;
  draggable: boolean; dropping: boolean; onDragStart: () => void; onDragOver: () => void; onDragLeave: () => void; onDrop: () => void; onOpen: () => void;
}) {
  return (
    <div data-node draggable={draggable} onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(n.id)); onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }} onDragLeave={onDragLeave} onDrop={(e) => { e.preventDefault(); onDrop(); }}>
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: dim ? 0.35 : 1, y: 0 }} transition={{ delay: Math.min(level, 6) * 0.03 }}
      className={cn("relative w-[210px] glass rounded-2xl p-3.5 text-left transition-all", draggable && "cursor-grab",
        dropping && "ring-2 ring-brand-400 scale-105", highlight && "ring-2 ring-flame-400/70", n.is_admin && "glow-border")}>
      {n.is_admin && level === 0 && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold text-on-accent" style={{ background: "var(--grad)" }}>{n.full_access ? "Same access as founder" : "Admin"}</span>}
      <button onClick={onOpen} className="w-full flex items-center gap-3 text-left">
        <span className="relative">
          <Avatar person={n} size={44} />
          {n.on_leave && <span title="On leave today" className="absolute -bottom-0.5 -right-0.5 grid place-items-center size-4 rounded-full bg-warn text-[#1b1b1b] ring-2 ring-ink-900"><Plane className="size-2.5" /></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 font-semibold text-[13.5px] truncate">{n.full_name}{n.is_admin && <ShieldCheck className="size-3.5 text-brand-300 shrink-0" />}</span>
          <span className="block text-[11.5px] text-fg-3 truncate">{n.roles[0] ?? n.designation ?? "—"}</span>
        </span>
      </button>
      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
        <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10.5px] text-fg-3">{n.employment_type}</span>
        {n.roles.length > 1 && <span className="rounded-md bg-brand-500/12 px-1.5 py-0.5 text-[10.5px] text-brand-300" title={n.roles.join(", ")}>+{n.roles.length - 1} roles</span>}
        {n.open_tasks > 0 && <span className="flex items-center gap-1 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10.5px] text-fg-3"><ListTodo className="size-3" />{n.open_tasks}</span>}
      </div>
      {kids > 0 && (
        <button onClick={onToggle} className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full border border-white/10 panel px-2 py-0.5 text-[10.5px] text-fg-2 hover:text-fg shadow">
          {kids}{open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      )}
    </motion.div>
    </div>
  );
}
