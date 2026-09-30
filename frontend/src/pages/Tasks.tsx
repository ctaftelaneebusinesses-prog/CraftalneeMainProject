import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { AlarmClock, ArrowRight, Check, CheckCircle2, Circle, CircleDot, Flag, ListChecks, ListTodo, MessageSquareText, Pencil, Plus, Trash2, User } from "lucide-react";
import { api, qs } from "@/lib/api";
import { cn, fmtDate, relative, today } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { can, useSession } from "@/lib/session";
import type { EmployeeBrief, NavCounts, Task, TaskStatus } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, PageHeader, PageSkeleton, SearchInput, Segmented, Textarea, type Tone } from "@/components/ui/core";
import { Drawer, useConfirm } from "@/components/ui/overlay";
import { PersonSelect } from "@/components/PersonSelect";
import { TaskDetailDrawer } from "@/components/TaskDetailDrawer";

const COLUMNS: { id: TaskStatus; label: string; icon: typeof Circle; accent: string }[] = [
  { id: "todo", label: "To do", icon: Circle, accent: "#9d84ff" },
  { id: "in_progress", label: "In progress", icon: CircleDot, accent: "#fbbf24" },
  { id: "done", label: "Done", icon: CheckCircle2, accent: "#34d399" },
];
const PRIORITY_TONE: Record<string, Tone> = { Low: "neutral", Medium: "info", High: "warn", Urgent: "bad" };
export function PriorityBadge({ p }: { p: string }) { return <Badge tone={PRIORITY_TONE[p] ?? "neutral"}><Flag className="size-3" />{p}</Badge>; }
export function TaskStatusBadge({ s }: { s: TaskStatus }) {
  const c = COLUMNS.find((x) => x.id === s)!;
  return <Badge tone={s === "done" ? "good" : s === "in_progress" ? "warn" : "brand"} dot>{c.label}</Badge>;
}

type Scope = "mine" | "assigned" | "team" | "all";

export default function Tasks() {
  const { user } = useSession();
  const admin = can(user, "team");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const { data: counts } = useQuery({ queryKey: ["nav-counts"], queryFn: () => api.get<NavCounts>("/nav-counts") });
  const canAssign = admin || !!counts?.can_assign;
  const [scope, setScope] = useState<Scope>(user?.employee ? "mine" : "all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const dq = useDebounced(q);

  useEffect(() => { if (params.get("new")) { setEditing("new"); params.delete("new"); setParams(params, { replace: true }); } }, [params, setParams]);

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", scope, dq],
    queryFn: () => api.get<{ tasks: Task[]; counts: Record<TaskStatus, number> }>(`/tasks${qs({ scope, q: dq })}`),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => ["tasks", "task", "nav-counts", "dashboard", "org"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) => api.put<{ task: Task }>(`/tasks/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      const key = ["tasks", scope, dq];
      const prev = qc.getQueryData<{ tasks: Task[] }>(key);
      if (prev) qc.setQueryData(key, { ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, status } : t)) });
      return { prev, key };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); },
    onSuccess: (r) => { invalidate(); if (r.task.status === "done") toast.success(`“${r.task.title}” completed 🎉`); },
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/tasks/${id}`), onSuccess: () => { invalidate(); toast.success("Task deleted"); } });

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  if (isLoading && !data) return <PageSkeleton />;
  const scopes: { value: Scope; label: string }[] = [
    ...(user?.employee ? [{ value: "mine" as Scope, label: "My tasks" }] : []),
    ...(canAssign ? [{ value: "assigned" as Scope, label: "Assigned by me" }] : []),
    ...(user?.employee && canAssign ? [{ value: "team" as Scope, label: "My team" }] : []),
    ...(admin ? [{ value: "all" as Scope, label: "Everyone" }] : []),
  ];
  const mayManage = (t: Task) => admin || t.created_by_id === user?.id;
  const mayMove = (t: Task) => mayManage(t) || t.assignee.id === user?.employee?.id;

  const onDrop = (e: DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setOver(null);
    const t = tasks.find((x) => x.id === dragId);
    if (t && t.status !== status && mayMove(t)) move.mutate({ id: t.id, status });
    setDragId(null);
  };

  return (
    <>
      <PageHeader eyebrow="Work" title="Tasks" subtitle={canAssign ? "Assign work to your team and track it to done. Drag cards between columns." : "Your assigned work. Drag a card to update its status."}
        actions={canAssign && <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>New task</Button>} />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        {scopes.length > 1 && <Segmented layoutId="task-scope" value={scope} onChange={setScope} options={scopes} />}
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} placeholder="Search tasks or people…" className="w-full sm:w-[280px]" />
      </div>

      {tasks.length === 0 && !dq ? (
        <Card><EmptyState icon={<ListTodo />} title={scope === "mine" ? "No tasks assigned to you" : "No tasks yet"}
          text={canAssign ? "Create a task and assign it to someone in your team." : "When your team lead assigns work, it appears here."}
          action={canAssign && <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>New task</Button>} /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {COLUMNS.map((col) => {
            const list = tasks.filter((t) => t.status === col.id);
            return (
              <div key={col.id} onDragOver={(e) => { e.preventDefault(); setOver(col.id); }} onDragLeave={() => setOver((o) => (o === col.id ? null : o))} onDrop={(e) => onDrop(e, col.id)}
                className={cn("rounded-2xl border p-3 transition-all min-h-[200px]", over === col.id ? "border-brand-400/60 bg-brand-500/[0.06]" : "border-white/[0.06] bg-white/[0.015]")}>
                <div className="flex items-center gap-2 px-2 pt-1 pb-3">
                  <col.icon className="size-4" style={{ color: col.accent }} />
                  <span className="font-display font-semibold text-[14px]">{col.label}</span>
                  <span className="ml-auto text-[12px] text-fg-4 tnum">{list.length}</span>
                </div>
                <div className="space-y-2.5">
                  <AnimatePresence initial={false}>
                    {list.map((t) => (
                      <motion.div key={t.id} layout layoutId={`task-${t.id}`} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}>
                        <TaskCard t={t} draggable={mayMove(t)} onDragStart={() => setDragId(t.id)} onOpen={() => setOpenId(t.id)}
                          onMove={mayMove(t) ? (s) => move.mutate({ id: t.id, status: s }) : undefined}
                          onEdit={mayManage(t) ? () => setEditing(t) : undefined}
                          onDelete={mayManage(t) ? async () => { if (await confirm({ title: "Delete task?", message: t.title, danger: true, confirmText: "Delete" })) del.mutate(t.id); } : undefined} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {!list.length && <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-[12.5px] text-fg-4">Drop tasks here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskDetailDrawer taskId={openId} onClose={() => setOpenId(null)} onEdit={(t) => { setOpenId(null); setEditing(t); }} />
      <TaskDrawer task={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); invalidate(); }} />
    </>
  );
}

function TaskCard({ t, draggable, onDragStart, onOpen, onMove, onEdit, onDelete }: {
  t: Task; draggable: boolean; onDragStart: () => void; onOpen: () => void; onMove?: (s: TaskStatus) => void; onEdit?: () => void; onDelete?: () => void;
}) {
  const overdue = t.due_date && t.status !== "done" && t.due_date < today();
  const next: Record<TaskStatus, TaskStatus | null> = { todo: "in_progress", in_progress: "done", done: null };
  return (
    <div draggable={draggable} onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) onOpen(); }}
      role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(); }}
      title="Open task" className={cn("group glass glass-hover p-4 rounded-xl cursor-pointer", draggable && "active:cursor-grabbing")}>
      <div className="flex items-start gap-2">
        <div className={cn("flex-1 font-medium text-[14px] leading-snug", t.status === "done" && "line-through text-fg-3")}>{t.title}</div>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && <button onClick={onEdit} className="p-1 rounded-md text-fg-4 hover:text-fg hover:bg-white/[0.06]" aria-label="Edit"><Pencil className="size-3.5" /></button>}
          {onDelete && <button onClick={onDelete} className="p-1 rounded-md text-fg-4 hover:text-bad hover:bg-white/[0.06]" aria-label="Delete"><Trash2 className="size-3.5" /></button>}
        </div>
      </div>
      {t.description && <p className="mt-1.5 text-[12.5px] text-fg-3 line-clamp-2">{t.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <PriorityBadge p={t.priority} />
        {t.due_date && <Badge tone={overdue ? "bad" : "neutral"}><AlarmClock className="size-3" />{overdue ? "Overdue · " : ""}{fmtDate(t.due_date, { day: "numeric", month: "short" })}</Badge>}
        {t.items_total > 0 && <Badge tone={t.items_done === t.items_total ? "good" : "neutral"}><ListChecks className="size-3" />{t.items_done}/{t.items_total}</Badge>}
        {t.notes_count > 0 && <Badge><MessageSquareText className="size-3" />{t.notes_count}</Badge>}
      </div>
      <div className="mt-3 pt-3 border-t divider flex items-center gap-2">
        <Avatar person={t.assignee} size={24} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium truncate">{t.assignee.full_name}</div>
          <div className="text-[11px] text-fg-4 truncate">by {t.created_by_name ?? "—"} · {t.status === "done" && t.completed_at ? `done ${relative(t.completed_at)}` : relative(t.created_at)}</div>
        </div>
        {onMove && next[t.status] && (
          <button onClick={() => onMove(next[t.status]!)} title={t.status === "todo" ? "Start" : "Mark done"}
            className={cn("grid place-items-center size-8 rounded-lg border transition-all", t.status === "in_progress" ? "border-good/40 text-good hover:bg-good/10" : "border-white/10 text-fg-3 hover:text-fg hover:border-white/25")}>
            {t.status === "in_progress" ? <Check className="size-4" /> : <ArrowRight className="size-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

function TaskDrawer({ task, onClose, onDone }: { task: Task | "new" | null; onClose: () => void; onDone: () => void }) {
  const { data } = useQuery({ queryKey: ["assignable"], queryFn: () => api.get<{ employees: EmployeeBrief[]; priorities: string[] }>("/tasks/assignable"), enabled: !!task });
  const [f, setF] = useState({ title: "", description: "", due_date: "", priority: "Medium" });
  const [assignee, setAssignee] = useState<number | null>(null);
  useEffect(() => {
    if (task === "new") { setF({ title: "", description: "", due_date: "", priority: "Medium" }); setAssignee(null); }
    else if (task) { setF({ title: task.title, description: task.description ?? "", due_date: task.due_date ?? "", priority: task.priority }); setAssignee(task.assignee.id); }
  }, [task]);
  const m = useMutation({
    mutationFn: () => task && task !== "new" ? api.put(`/tasks/${task.id}`, { ...f, assignee_id: assignee }) : api.post("/tasks", { ...f, assignee_id: assignee }),
    onSuccess: () => { toast.success(task === "new" ? "Task assigned" : "Task updated"); onDone(); },
  });
  const people = data?.employees ?? [];
  return (
    <Drawer open={!!task} onClose={onClose} title={task === "new" ? "New task" : "Edit task"} subtitle="The assignee sees it instantly in their Tasks."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Check />} loading={m.isPending} disabled={!f.title.trim() || !assignee} onClick={() => m.mutate()}>{task === "new" ? "Assign task" : "Save"}</Button></>}>
      <div className="space-y-5">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Build the login page" autoFocus /></Field>
        <Field label="Assign to" hint={people.length ? `${people.length} people in your reporting line` : "No one reports to you yet."}>
          <PersonSelect people={people} value={assignee} onChange={setAssignee} placeholder="Choose a person" />
        </Field>
        <Field label="Priority">
          <div className="flex flex-wrap gap-2">
            {(data?.priorities ?? ["Low", "Medium", "High", "Urgent"]).map((p) => (
              <button key={p} type="button" onClick={() => setF({ ...f, priority: p })}
                className={cn("inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border text-[13px] transition-all", f.priority === p ? "border-white/25 bg-white/10 text-fg" : "border-white/[0.08] text-fg-3 hover:text-fg")}>
                <Flag className="size-3.5" />{p}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Due date" optional><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Details" optional><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[130px]" placeholder="What needs to be done? Links, acceptance criteria…" /></Field>
        {task && task !== "new" && <div className="flex items-center gap-2 text-[12.5px] text-fg-4"><User className="size-3.5" /> Created by {task.created_by_name}</div>}
      </div>
    </Drawer>
  );
}
